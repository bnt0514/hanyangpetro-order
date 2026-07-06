'use client';

import { useEffect, useRef, useState, useId, useCallback, useMemo } from 'react';

export interface ComboboxOption {
    value: string;          // 내부 식별자 (id)
    label: string;          // 화면 표시 + 1차 검색 대상
    sublabel?: string;      // 보조 텍스트 + 2차 검색 대상 (예: 제품코드)
}

interface Props {
    options: ComboboxOption[];
    value: string;
    onChange: (value: string, label: string) => void;
    className?: string;
    dropdownClassName?: string;
    optionLabelClassName?: string;
    placeholder?: string;
    label?: string;
    required?: boolean;
    disabled?: boolean;
    emptyText?: string;
    /** value가 비어있을 때 input에 표시할 기본 텍스트 (예: 거래처명 자동 채우기) */
    defaultText?: string;
    searchSublabel?: boolean;
    /** 옵션 매칭 없이 자유 텍스트가 입력된 채로 확정될 때 호출 */
    onFreeText?: (text: string) => void;
    /** 값이 입력되어 있어도 포커스 시 전체 옵션을 보여줌 */
    showAllOnFocus?: boolean;
    /** 정규화된 검색어별로 표시 가능한 정규화 label을 제한 */
    normalizedLabelAllowlistByQuery?: Record<string, string[]>;
}

/* ── 매칭 정규화 ────────────────────────────────────────────
 * - 소문자화
 * - "(주)", "주식회사", "(유)", "(사)" 같은 회사형식 prefix 제거
 * - 공백/괄호/특수문자 모두 제거 → 핵심 글자/숫자만 비교
 *   예) "(주)소정폴리텍" → "소정폴리텍"
 *       "EVA<1540>"     → "eva1540"  → "1540" 검색 시 매칭됨
 */
function normalize(s: string): string {
    if (!s) return '';
    return s
        .toLowerCase()
        .replace(/주식\s*회사/g, '')
        .replace(/\(주\)|\(유\)|\(사\)|\(합\)|\(재\)/g, '')
        .replace(/[\s()[\]{}<>\-_/\\.,·•]+/g, '')
        .trim();
}

export default function Combobox({
    options,
    value,
    onChange,
    className = '',
    dropdownClassName = '',
    optionLabelClassName = 'truncate',
    placeholder,
    label,
    required,
    disabled,
    emptyText = '결과 없음',
    defaultText,
    searchSublabel = true,
    onFreeText,
    showAllOnFocus = false,
    normalizedLabelAllowlistByQuery,
}: Props) {
    const id = useId();
    const wrapRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const isTypingRef = useRef(false);
    const skipNextBlurCommitRef = useRef(false);
    const [isTyping, setIsTyping] = useState(false);

    const valueLabel = useMemo(
        () => options.find((o) => o.value === value)?.label ?? '',
        [options, value],
    );

    const [text, setText] = useState(valueLabel || defaultText || '');
    const [open, setOpen] = useState(false);
    const [hi, setHi] = useState(0);
    const [showAll, setShowAll] = useState(false);

    // 외부에서 value 바뀐 경우에만 input sync (사용자 타이핑 중에는 차단)
    // value가 비어 있으면 defaultText를 표시
    useEffect(() => {
        if (!isTypingRef.current) setText(valueLabel || defaultText || '');
    }, [valueLabel, defaultText]);

    // 외부 클릭 → 닫기
    useEffect(() => {
        function handler(e: MouseEvent) {
            if (!wrapRef.current?.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // ── 필터 + 정렬 (대소문자 무관 + 부분 포함) ───────────────
    // 점수: 0=완전일치, 1=startsWith, 2=contains
    const filtered = useMemo(() => {
        if (showAllOnFocus && showAll && !isTyping) return options.slice(0, 100);
        const q = normalize(text);
        const allowlist = normalizedLabelAllowlistByQuery?.[q];
        const allowedLabels = allowlist ? new Set(allowlist) : null;
        const scored: { opt: ComboboxOption; score: number }[] = [];

        for (const opt of options) {
            const nl = normalize(opt.label);
            if (allowedLabels && !allowedLabels.has(nl)) continue;
            const ns = searchSublabel ? normalize(opt.sublabel ?? '') : '';
            if (q === '') {
                scored.push({ opt, score: 3 });
                continue;
            }
            if (nl === q || ns === q) scored.push({ opt, score: 0 });
            else if (nl.startsWith(q)) scored.push({ opt, score: 1 });
            else if (nl.includes(q) || ns.includes(q)) scored.push({ opt, score: 2 });
        }

        const sorted = scored
            .sort((a, b) => {
                if (a.score !== b.score) return a.score - b.score;
                // 동점이면 normalized label 길이가 짧을수록 우선 (3120 > 3120MF)
                const lenDiff = normalize(a.opt.label).length - normalize(b.opt.label).length;
                if (lenDiff !== 0) return lenDiff;
                return a.opt.label.localeCompare(b.opt.label, 'ko');
            })
            .map((s) => s.opt);

        if (allowedLabels) {
            const seenLabels = new Set<string>();
            return sorted.filter((opt) => {
                const key = normalize(opt.label);
                if (seenLabels.has(key)) return false;
                seenLabels.add(key);
                return true;
            }).slice(0, 100);
        }

        return sorted.slice(0, 100);
    }, [isTyping, normalizedLabelAllowlistByQuery, options, searchSublabel, showAll, showAllOnFocus, text]);

    const select = useCallback(
        (opt: ComboboxOption) => {
            isTypingRef.current = false;
            setIsTyping(false);
            skipNextBlurCommitRef.current = true;
            onChange(opt.value, opt.label);
            setText(opt.label);
            setOpen(false);
        },
        [onChange],
    );

    /** 입력 텍스트가 옵션과 일치하면 자동 커밋. 아니면 필터 결과 1순위 채택.
     * 아무 옵션도 없을 경우 onFreeText 콜백 호출. */
    function commit() {
        const q = normalize(text);
        if (q === '') {
            if (value) {
                // 선택된 값이 있는데 text가 비었으면 text만 복원 (blur 타이밍 이슈 방지)
                setText(valueLabel || defaultText || '');
                return;
            }
            onFreeText?.('');
            return;
        }
        const exact = options.find(
            (o) => normalize(o.label) === q || (searchSublabel && normalize(o.sublabel ?? '') === q),
        );
        if (exact) {
            select(exact);
            onFreeText?.(text);
            return;
        }
        if (filtered.length > 0) {
            select(filtered[Math.min(hi, filtered.length - 1)]);
            return;
        }
        // 매칭되는 옵션이 전혀 없음 → 자유 텍스트 확정
        onFreeText?.(text);
    }

    function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') {
            e.preventDefault(); // 폼 submit 방지
            commit();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setHi((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
        } else if (e.key === 'Escape') {
            setOpen(false);
            isTypingRef.current = false;
            setIsTyping(false);
            setText(valueLabel);
        } else if (e.key === 'Tab') {
            skipNextBlurCommitRef.current = true;
            commit();
        }
    }

    return (
        <div ref={wrapRef} className={`block ${className}`}>
            {label && (
                <label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1.5">
                    {label}
                    {required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
            )}
            <div className="relative">
                <input
                    id={id}
                    ref={inputRef}
                    type="text"
                    value={text}
                    placeholder={placeholder}
                    disabled={disabled}
                    autoComplete="off"
                    onChange={(e) => {
                        isTypingRef.current = true;
                        setIsTyping(true);
                        setShowAll(false);
                        setText(e.target.value);
                        setOpen(true);
                        setHi(0);
                    }}
                    onFocus={() => {
                        setShowAll(true);
                        setOpen(true);
                    }}
                    onBlur={() => {
                        // 옵션 클릭과 충돌 방지를 위해 약간 지연
                        setTimeout(() => {
                            if (skipNextBlurCommitRef.current) {
                                skipNextBlurCommitRef.current = false;
                                setOpen(false);
                                return;
                            }
                            isTypingRef.current = false;
                            setIsTyping(false);
                            setShowAll(false);
                            commit();
                        }, 150);
                    }}
                    onKeyDown={onKeyDown}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500"
                />
                {open && !disabled && (
                    <div className={`absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg ${dropdownClassName}`}>
                        {filtered.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-slate-400">{emptyText}</div>
                        ) : (
                            filtered.map((opt, idx) => (
                                <button
                                    type="button"
                                    key={opt.value}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        select(opt);
                                    }}
                                    onMouseEnter={() => setHi(idx)}
                                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition ${idx === hi
                                        ? 'bg-blue-50 text-blue-700'
                                        : 'text-slate-700 hover:bg-slate-50'
                                        }`}
                                >
                                    <span className={optionLabelClassName}>{opt.label}</span>
                                    {opt.sublabel && (
                                        <span className="ml-3 shrink-0 text-xs text-slate-400">
                                            {opt.sublabel}
                                        </span>
                                    )}
                                </button>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
