import { z } from 'zod';
import { superAdmin, requireAdminMFA } from '@/lib/platform';
import { db, fail, guard, rateLimit, readJson, HttpError } from '@/lib/server';
import { readCommunityAdmin, moderateCommunity } from '@/lib/community-admin-service';

export const dynamic = 'force-dynamic';
const json = (value: unknown) => Response.json(value, { headers: { 'Cache-Control': 'no-store' } });

const modes = ['overview','posts','comments','groups','members','memberships','reports','logs'] as const;

export async function GET(request: Request) {
  try {
    const user = await superAdmin();
    await rateLimit(user.userId, 'community-admin-read', 60);
    await requireAdminMFA();
    const params = new URL(request.url).searchParams;
    const mode = z.enum(modes).parse(params.get('mode') || 'overview');
    const status = (params.get('status') || 'all').slice(0, 30);
    return json(await readCommunityAdmin(db(), mode, params.get('q') || '', status));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    guard(request);
    const user = await superAdmin();
    await rateLimit(user.userId, 'community-admin-write', 30);
    await requireAdminMFA();
    const input = await readJson(request, 12000);
    return json(await moderateCommunity(db(), user.userId, input));
  } catch (error) {
    if (error instanceof z.ZodError) return fail(new HttpError(400, 'Check the moderation form values.'));
    return fail(error);
  }
}
