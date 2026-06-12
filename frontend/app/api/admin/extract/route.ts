import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const ADMIN_SECRET = process.env.ADMIN_SECRET;

export async function POST(req: NextRequest) {
  if (!ADMIN_SECRET) {
    return NextResponse.json({ error: 'Admin not configured' }, { status: 503 });
  }

  const formData = await req.formData();
  const res = await fetch(`${API_URL}/api/admin/extract`, {
    method: 'POST',
    headers: { 'X-Admin-Secret': ADMIN_SECRET },
    body: formData,
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
