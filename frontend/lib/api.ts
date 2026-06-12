import { getFingerprint } from './fingerprint';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

let accessToken: string | null = null;
let viewSessionToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setViewSessionToken(token: string | null): void {
  viewSessionToken = token;
}

export function getViewSessionToken(): string | null {
  return viewSessionToken;
}

interface FetchOptions extends RequestInit {
  auth?: boolean;
  viewSession?: boolean;
}

export async function apiFetch<T = unknown>(path: string, options: FetchOptions = {}): Promise<T> {
  const { auth, viewSession, headers: customHeaders, ...rest } = options;
  const headers: Record<string, string> = {
    ...(customHeaders as Record<string, string>),
  };

  if (!(rest.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  if (auth && accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  if (viewSession && viewSessionToken) {
    headers['X-View-Session'] = viewSessionToken;
  }

  if (typeof window !== 'undefined') {
    headers['X-Device-Fingerprint'] = await getFingerprint();
  }

  const res = await fetch(`${API_URL}${path}`, { ...rest, headers });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    const error = new Error(err.error || 'Request failed') as Error & { requiresTotp?: boolean };
    if (err.requiresTotp) error.requiresTotp = true;
    throw error;
  }

  const contentType = res.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return res.json();
  }
  return res as unknown as T;
}

export async function apiFetchBlob(path: string, viewSession = true): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (viewSession && viewSessionToken) {
    headers['X-View-Session'] = viewSessionToken;
  }
  headers['X-Device-Fingerprint'] = await getFingerprint();

  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) throw new Error('Failed to fetch content');
  return res.blob();
}

export async function uploadFile(
  path: string,
  formData: FormData,
  onProgress?: (percent: number) => void
): Promise<{ token: string; shareUrl: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}${path}`);
    if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.error || 'Upload failed'));
        } catch {
          reject(new Error('Upload failed'));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(formData);
  });
}
