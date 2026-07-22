import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getTodayShipmentView } from '@/app/today-shipping/actions';
import TodayShippingClient from './TodayShippingClient';

export const dynamic = 'force-dynamic';

export default async function AdminTodayShippingPage() {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const view = await getTodayShipmentView();

    return (
        <div className="min-h-full bg-[#fff7ed] p-3 md:p-6">
            <div className="mx-auto max-w-6xl">
                <TodayShippingClient initialView={view} />
            </div>
        </div>
    );
}
