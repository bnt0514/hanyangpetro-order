import LoginForm from './LoginForm';

export const metadata = {
    title: '로그인 · 한양유화 e-Business OS',
};

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
    return (
        <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 flex items-center justify-center px-4 py-12">
            <LoginForm />
        </main>
    );
}
