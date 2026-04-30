import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

export default async function RootIndex() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.userKind === 'customer') redirect('/portal');
  redirect('/admin');
}