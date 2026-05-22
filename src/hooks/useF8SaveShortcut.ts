'use client';

import { type RefObject, useEffect, useRef } from 'react';

type Options = {
    disabled?: boolean;
    scopeRef?: RefObject<HTMLElement | null>;
    requireFocusWithin?: boolean;
};

export function useF8SaveShortcut(onSave: () => void, { disabled = false, scopeRef, requireFocusWithin = true }: Options = {}) {
    const onSaveRef = useRef(onSave);

    useEffect(() => {
        onSaveRef.current = onSave;
    }, [onSave]);

    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key !== 'F8' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || disabled) return;

            const scope = scopeRef?.current;
            if (scope && requireFocusWithin) {
                const activeElement = document.activeElement;
                if (!activeElement || !scope.contains(activeElement)) return;
            }

            event.preventDefault();
            onSaveRef.current();
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [disabled, requireFocusWithin, scopeRef]);
}