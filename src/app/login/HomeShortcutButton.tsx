'use client';

import { useEffect, useState } from 'react';

type Platform = 'android' | 'ios' | 'windows' | 'mac' | 'other';

function detectPlatform(): Platform {
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
    if (/windows/i.test(ua)) return 'windows';
    if (/mac/i.test(ua)) return 'mac';
    return 'other';
}

export default function HomeShortcutButton() {
    const [installed, setInstalled] = useState(false);
    const [showGuide, setShowGuide] = useState(false);
    const [platform, setPlatform] = useState<Platform>('other');

    useEffect(() => {
        const standalone = ('standalone' in window.navigator) && (window.navigator as { standalone?: boolean }).standalone;
        if (standalone) { setInstalled(true); return; }
        setPlatform(detectPlatform());

        function onAppInstalled() { setInstalled(true); }
        window.addEventListener('appinstalled', onAppInstalled);
        return () => window.removeEventListener('appinstalled', onAppInstalled);
    }, []);

    if (installed) {
        return (
            <div className="mt-4 text-center">
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                    ✓ 홈화면 바로가기 추가됨
                </span>
            </div>
        );
    }

    return (
        <div className="mt-4 text-center">
            <button
                type="button"
                onClick={() => setShowGuide(g => !g)}
                className="inline-flex items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
            >
                📲 홈화면에 바로가기 만들기
            </button>

            {showGuide && (
                <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 text-left text-xs leading-5 text-slate-700 shadow-sm">
                    {platform === 'ios' && (
                        <>
                            <p className="mb-2 font-bold text-slate-900">iPhone / iPad 홈화면 추가 방법</p>
                            <ol className="list-decimal space-y-1 pl-4">
                                <li>화면 하단 가운데 <strong>공유(□↑)</strong> 버튼 탭</li>
                                <li>스크롤해서 <strong>홈 화면에 추가</strong> 선택</li>
                                <li>우측 상단 <strong>추가</strong> 버튼 탭</li>
                            </ol>
                            <p className="mt-2 text-[11px] text-slate-400">반드시 Safari 브라우저에서 접속해야 합니다.</p>
                        </>
                    )}
                    {platform === 'android' && (
                        <>
                            <p className="mb-2 font-bold text-slate-900">Android 홈화면 추가 방법</p>
                            <ol className="list-decimal space-y-1 pl-4">
                                <li>브라우저 <strong>우측 하단 가로줄 2개(≡)</strong> 메뉴 버튼 탭</li>
                                <li><strong>홈 화면에 추가</strong> 선택</li>
                                <li><strong>추가</strong> 버튼 탭</li>
                            </ol>
                            <p className="mt-2 text-[11px] text-slate-400">Chrome, Samsung Internet 등 브라우저마다 메뉴 위치가 다를 수 있습니다.</p>
                        </>
                    )}
                    {platform === 'windows' && (
                        <>
                            <p className="mb-2 font-bold text-slate-900">Windows PC 홈화면 바로가기 추가 방법</p>
                            <p className="mb-1 font-semibold text-slate-800">· Edge (권장)</p>
                            <ol className="list-decimal space-y-1 pl-4 mb-2">
                                <li>우측 상단 <strong>메뉴(…)</strong> 클릭</li>
                                <li><strong>전송, 저장, 공유</strong> 선택</li>
                                <li><strong>바로가기 만들기</strong> 클릭</li>
                            </ol>
                            <p className="mb-1 font-semibold text-slate-800">· Chrome</p>
                            <ol className="list-decimal space-y-1 pl-4">
                                <li>우측 상단 <strong>메뉴(⋮)</strong> 클릭</li>
                                <li><strong>저장 및 공유</strong> → <strong>바로가기 만들기</strong> 클릭</li>
                            </ol>
                        </>
                    )}
                    {platform === 'mac' && (
                        <>
                            <p className="mb-2 font-bold text-slate-900">Mac 홈화면 바로가기 추가 방법</p>
                            <p className="mb-1 font-semibold text-slate-800">· Safari</p>
                            <ol className="list-decimal space-y-1 pl-4 mb-2">
                                <li>상단 메뉴 <strong>파일</strong> → <strong>Dock에 추가</strong> 클릭</li>
                            </ol>
                            <p className="mb-1 font-semibold text-slate-800">· Chrome / Edge</p>
                            <ol className="list-decimal space-y-1 pl-4">
                                <li>우측 상단 <strong>메뉴(⋮)</strong> 클릭</li>
                                <li><strong>저장 및 공유</strong> → <strong>바로가기 만들기</strong> 클릭</li>
                            </ol>
                        </>
                    )}
                    {platform === 'other' && (
                        <>
                            <p className="mb-2 font-bold text-slate-900">홈화면 바로가기 추가 방법</p>
                            <ol className="list-decimal space-y-1 pl-4">
                                <li>브라우저 메뉴 버튼 클릭</li>
                                <li><strong>홈 화면에 추가</strong> 또는 <strong>바로가기 만들기</strong> 선택</li>
                            </ol>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
