import { NextResponse } from 'next/server';

const BACKEND = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function GET() {
    try {
        const res = await fetch(`${BACKEND}/admin/rada/schedule`, {
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
        });
        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('❌ GET Error:', error);
        return NextResponse.json({ enabled: true });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        console.log('sending to python:', body); // Перевір це в терміналі VS Code (Next.js лог)

        const res = await fetch(`${BACKEND}/admin/rada/schedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errorText = await res.text();
            console.error('❌ Python Error:', errorText);
            return NextResponse.json({ error: errorText }, { status: res.status });
        }

        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('❌ Fetch Error:', error);
        return NextResponse.json({ error: 'Backend unavailable' }, { status: 503 });
    }
}
