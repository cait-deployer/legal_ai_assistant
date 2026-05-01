import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getIpUsageInheritancePatch } from '@/lib/auth/ip-usage';

async function getGeo(ip: string): Promise<Record<string, string>> {
    if (!ip || ['127.0.0.1', '::1', 'localhost', ''].includes(ip)) return {};
    const privateRanges = ['10.', '172.16.', '172.17.', '192.168.', '::ffff:127.'];
    if (privateRanges.some(r => ip.startsWith(r))) return {};

    try {
        const res = await fetch(
            `http://ip-api.com/json/${ip}?fields=status,city,country,countryCode&lang=uk`,
            { signal: AbortSignal.timeout(3000) },
        );
        const data = await res.json();
        if (data.status === 'success') {
            return {
                city: data.city ?? '',
                country: data.country ?? '',
                country_code: data.countryCode ?? '',
            };
        }
    } catch {
        // geo lookup failed — not critical
    }
    return {};
}

export async function POST(request: Request) {
    const body = await request.json().catch(() => ({}));

    // 1. Отримуємо юзера двома шляхами для надійності:
    // - або з поточної сесії (якщо вже залогінений)
    // - або з body (якщо це момент реєстрації)
    const supabase = await createClient();
    const {
        data: { user: sessionUser },
    } = await supabase.auth.getUser();

    const userId = sessionUser?.id || body.userId;
    const fingerprint: string | undefined = body.fingerprint;

    // Якщо юзера немає ні в сесії, ні в запиті — тільки тоді 401
    if (!userId) {
        return NextResponse.json({ ok: false, message: 'User not identified' }, { status: 401 });
    }

    // 2. Визначаємо IP (пріоритет: clientIp з фронта -> заголовки сервера)
    const forwarded = request.headers.get('x-forwarded-for');
    const serverIp = forwarded
        ? forwarded.split(',')[0].trim()
        : (request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip') ?? '');

    const ip = serverIp || (body.clientIp as string | undefined) || '';

    // 3. Збираємо дані
    const ua = request.headers.get('user-agent') ?? '';
    const geo = await getGeo(ip);

    // 4. Ініціалізуємо Admin Client для обходу RLS (бо юзер може бути unconfirmed)
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) return NextResponse.json({ ok: false }, { status: 500 });

    const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    // 5. Формуємо патч для бази
    const patch: Record<string, string | number | boolean | null> = {
        last_ip: ip || null,
        user_agent: ua || null,
        last_city: geo.city || null,
        last_country: geo.country || null,
        last_country_code: geo.country_code || null,
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    if (fingerprint) patch.browser_fingerprint = fingerprint;
    Object.assign(patch, await getIpUsageInheritancePatch(admin, userId, ip));
    // Propagate trial_used from fingerprint-check (anti-multi-account)
    if (body.trial_used === true) patch.trial_used = true;

    // Оновлюємо профіль
    const { error: updateError } = await admin.from('profiles').update(patch).eq('id', userId);

    if (updateError) {
        console.error('Profile update failed:', updateError);
        return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, ip, geo });
}
