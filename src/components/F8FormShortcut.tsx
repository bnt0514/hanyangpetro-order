'use client';

import { useEffect } from 'react';

type Props = {
    formIdPrefix?: string;
};

export default function F8FormShortcut({ formIdPrefix }: Props) {
    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key !== 'F8' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;

            const activeElement = document.activeElement as HTMLElement | null;
            const explicitFormId = activeElement?.getAttribute('form');
            const form = explicitFormId
                ? document.getElementById(explicitFormId)
                : activeElement?.closest('form');

            if (!(form instanceof HTMLFormElement)) return;
            if (formIdPrefix && !form.id.startsWith(formIdPrefix)) return;

            event.preventDefault();
            form.requestSubmit();
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [formIdPrefix]);

    return null;
}