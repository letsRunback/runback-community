const BUFFER_API = "https://api.buffer.com";

async function bufferGraphQL<T>(accessToken: string, query: string): Promise<T> {
  const res = await fetch(BUFFER_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Buffer API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`Buffer API error: ${json.errors.map((e) => e.message).join("; ")}`);
  if (!json.data) throw new Error("Buffer API: empty response");
  return json.data;
}

export interface BufferProfile {
  id: string;
  service: "linkedin" | "twitter" | "instagram" | "bluesky" | string;
  service_username: string;
}

export interface CreatePostResult {
  id: string;
  profile_id: string;
}

/** Buffer's account is scoped to an organization; every other call needs its id. */
export async function getOrganizationId(accessToken: string): Promise<string> {
  const data = await bufferGraphQL<{ account: { organizations: { id: string }[] } }>(
    accessToken,
    `query { account { organizations { id } } }`
  );
  const orgId = data.account.organizations[0]?.id;
  if (!orgId) throw new Error("Buffer account has no organizations");
  return orgId;
}

export async function getProfiles(accessToken: string): Promise<BufferProfile[]> {
  const organizationId = await getOrganizationId(accessToken);
  const data = await bufferGraphQL<{
    channels: { id: string; name: string; service: string }[];
  }>(
    accessToken,
    `query { channels(input: { organizationId: ${JSON.stringify(organizationId)} }) { id name service } }`
  );
  return data.channels.map((c) => ({ id: c.id, service: c.service, service_username: c.name }));
}

/**
 * Confirms a post createPost() reported as created actually exists in
 * Buffer. Found by direct investigation: createPost's mutation can return a
 * clean success with a real-looking post id, and that post can still not
 * exist at all — querying it back returns "Post not found for id: …". The
 * likely cause is Buffer's own async processing (e.g. fetching our
 * dynamically-rendered social-card image) failing after the synchronous
 * mutation already acknowledged the request; either way, trusting the
 * mutation response alone let a real post silently vanish while our own
 * database recorded it as delivered, with no error anywhere and no way to
 * retry it. Callers should verify before treating a post as delivered.
 */
export async function verifyPost(accessToken: string, postId: string): Promise<{ exists: boolean; status?: string; error?: string }> {
  try {
    const data = await bufferGraphQL<{ post: { id: string; status: string; error: { message: string } | null } }>(
      accessToken,
      `query { post(input: { id: ${JSON.stringify(postId)} }) { id status error { message } } }`
    );
    if (data.post.error) return { exists: true, status: data.post.status, error: data.post.error.message };
    return { exists: true, status: data.post.status };
  } catch (e) {
    // bufferGraphQL throws on any GraphQL error, including the NOT_FOUND
    // Buffer returns for a post id that doesn't (or no longer) exists.
    return { exists: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Polls verifyPost instead of checking once. Found by direct investigation:
 * Buffer's own processing of a newly created post (notably fetching our
 * dynamically-rendered social-card image) is genuinely asynchronous —
 * observed Buffer re-fetching that image nearly a minute after the create
 * mutation returned. A single check moments after creation can't
 * distinguish "genuinely failed" from "hasn't finished processing yet",
 * so it stops as soon as the post is found to exist (whether or not it
 * later reports a publishing error) and only gives up as not-found after
 * exhausting every attempt.
 */
export async function waitForPost(
  accessToken: string,
  postId: string,
  opts: { attempts?: number; intervalMs?: number } = {}
): Promise<{ exists: boolean; status?: string; error?: string }> {
  const attempts = opts.attempts ?? 9;
  const intervalMs = opts.intervalMs ?? 5000;
  let last: { exists: boolean; status?: string; error?: string } = { exists: false };
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    last = await verifyPost(accessToken, postId);
    if (last.exists) return last;
  }
  return last;
}

export async function createPost(
  accessToken: string,
  profileIds: string[],
  text: string,
  // `image` is required, not optional — every post this codebase creates must
  // carry an image. Plain-text posts to LinkedIn/etc. are not allowed; if a
  // future call site has no sensible image, that's a signal to add one to
  // SIGNAL_IMAGES in socialContent.ts, not to make this field optional.
  opts: { scheduledAt?: Date; link?: string; image: string; asDraft?: boolean }
): Promise<CreatePostResult[]> {
  const body = opts.link ? `${text}\n\n${opts.link}` : text;
  const scheduling = opts.scheduledAt
    ? `schedulingType: customScheduled, mode: customScheduled, dueAt: ${JSON.stringify(opts.scheduledAt.toISOString())}`
    : `schedulingType: automatic, mode: addToQueue`;
  const draftField = opts.asDraft ? `, saveToDraft: true` : "";

  const results: CreatePostResult[] = [];
  // The GraphQL API creates one post per channel per call.
  for (const channelId of profileIds) {
    const data = await bufferGraphQL<{
      createPost:
        | { __typename?: string; post: { id: string; status: string } }
        | { __typename?: string; message: string };
    }>(
      accessToken,
      `mutation {
        createPost(input: {
          text: ${JSON.stringify(body)}
          channelId: ${JSON.stringify(channelId)}
          ${scheduling}
          assets: [{ image: { url: ${JSON.stringify(opts.image)} } }]${draftField}
        }) {
          ... on PostActionSuccess { post { id status } }
          ... on MutationError { message }
        }
      }`
    );
    const result = data.createPost;
    if ("message" in result) throw new Error(`Buffer createPost error: ${result.message}`);
    results.push({ id: result.post.id, profile_id: channelId });
  }
  return results;
}
