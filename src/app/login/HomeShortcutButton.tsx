'use client';

import { useEffect, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export default function HomeShortcutButton() {
    const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [installed, setInstalled] = useState(false);
    const [showGuide, setShowGuide] = useState(false);
    const [isIos, setIsIos] = useState(false);

    useEffect(() => {
        const standalone = ('standalone' in window.navigator) && (window.navigator as { standalone?: boolean }).standalone;
        if (standalone) { setInstalled(true); return; }

        const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
        setIsIos(ios);

        function onBeforeInstallPrompt(event: Event) {
            event.preventDefault();
            setInstallPrompt(event as BeforeInstallPromptEvent);
        }
        function onAppInstalled() {
            setInstalled(true);
            setInstallPrompt(null);
        }
        window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
        window.addEventListener('appinstalled', onAppInstalled);
        return () => {
            window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
            window.removeEventListener('appinstalled', onAppInstalled);
        };
    }, []);

    async function handleClick() {
        if (installPrompt) {
            await installPrompt.prompt();
            const { outcome } = await installPrompt.userChoice;
            if (outcome === 'accepted') setInstalled(true);
            setInstallPrompt(null);
            return;
        }
        setShowGuide(true);
    }

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
                onClick={handleClick}
                className={`inline-flex items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    installPrompt
                        ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 shadow-sm'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
            >
                📲 홈화면에 바로가기 만들기
            </button>
            {showGuide && (
                <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 text-left text-xs leading-5 text-slate-700 shadow-sm">
                    {isIos ? (
                        <>
                            <p className="mb-2 font-bold text-slate-900">iPhone 홈화면 추가 방법</p>
                            <ol className="list-decimal space-y-1 pl-4">
                                <li>하단 공유 버튼 탭</li>
                                <li>스크롤해서 <strong>홈 화면에 추가</strong> 선택</li>
                                <li><strong>추가</strong> 버튼 탭</li>
                            </ol>
                            <p className="mt-2 text-[11px] text-slate-400">반드시 Safari에서 접속해야 합니다.</p>
                        </>
                    ) : (
                        <>
                            <p className="mb-2 font-bold text-slate-900">홈화면 추가 방법</p>
                            <ol className="list-decimal space-y-1 pl-4">
                                <li>브라우저 우측 상단 메뉴(⋮) 탭</li>
                                <li><strong>홈 화면에 추가</strong> 선택</li>
                            </ol>
                            <p className="mt-2 text-[11px] text-slate-400">Android Chrome에서는 버튼 한 번으로 바로 추가됩니다.</p>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
