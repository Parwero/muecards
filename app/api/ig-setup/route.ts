import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/ig-setup
 *
 * Uses IG_ACCESS_TOKEN to discover the Instagram Business / Creator account ID
 * linked to the user's Facebook Pages.
 *
 * Steps:
 *   1. GET /me/accounts — list Facebook Pages the token owns
 *   2. For each page, GET /{page-id}?fields=instagram_business_account
 *   3. Return the first numeric IG account ID found
 *
 * Only accessible from the /setup page during initial configuration.
 */
export async function GET() {
  const token = process.env.IG_ACCESS_TOKEN;
  const version = process.env.IG_GRAPH_VERSION ?? 'v21.0';
  const base = `https://graph.facebook.com/${version}`;

  if (!token) {
    return NextResponse.json(
      { error: 'IG_ACCESS_TOKEN not set in environment variables.' },
      { status: 500 },
    );
  }

  try {
    // Step 1: get user's pages
    const pagesUrl = new URL(`${base}/me/accounts`);
    pagesUrl.searchParams.set('access_token', token);
    pagesUrl.searchParams.set('fields', 'id,name,access_token');

    const pagesRes = await fetch(pagesUrl);
    const pagesJson = await pagesRes.json();

    if (!pagesRes.ok) {
      throw new Error(pagesJson?.error?.message ?? `Pages API error ${pagesRes.status}`);
    }

    const pages: Array<{ id: string; name: string; access_token: string }> =
      pagesJson?.data ?? [];

    if (pages.length === 0) {
      return NextResponse.json({
        found: false,
        message:
          'No Facebook Pages found for this token. Make sure the token has pages_show_list scope and is linked to a Page.',
        pages: [],
      });
    }

    // Step 2: for each page, look for an IG Business account
    const results: Array<{
      page_id: string;
      page_name: string;
      ig_user_id: string | null;
    }> = [];

    for (const page of pages) {
      const igUrl = new URL(`${base}/${page.id}`);
      igUrl.searchParams.set('fields', 'instagram_business_account');
      igUrl.searchParams.set('access_token', page.access_token);

      const igRes = await fetch(igUrl);
      const igJson = await igRes.json();

      results.push({
        page_id: page.id,
        page_name: page.name,
        ig_user_id: igJson?.instagram_business_account?.id ?? null,
      });
    }

    const match = results.find((r) => r.ig_user_id !== null);

    return NextResponse.json({
      found: Boolean(match),
      ig_user_id: match?.ig_user_id ?? null,
      page_name: match?.page_name ?? null,
      all_pages: results,
    });
  } catch (err) {
    console.error('[ig-setup] error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unexpected error' },
      { status: 500 },
    );
  }
}
