const HOMEPAGE_ARCHIVE_URL = 'https://hanyangpetro.com';

export default function HomepageArchiveLink({ className = '' }: { className?: string }) {
    return (
        <a
            href={HOMEPAGE_ARCHIVE_URL}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex shrink-0 items-center rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-[11px] font-bold text-orange-700 transition hover:border-orange-300 hover:bg-orange-100 ${className}`}
        >
            홈페이지자료실
        </a>
    );
}
