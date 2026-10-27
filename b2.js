// Backblaze B2 (native API, no dependencies): Hermes uploads garment photos to the
// private bucket; Clover later signs short-lived download links for them.
const crypto = require("node:crypto");

let session = null;

async function authorize() {
  if (session && session.until > Date.now()) return session;
  const basic = Buffer.from(`${process.env.B2_KEY_ID}:${process.env.B2_APPLICATION_KEY}`).toString("base64");
  const res = await fetch("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", {
    headers: { Authorization: `Basic ${basic}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`B2 authorize ${res.status}`);
  const a = await res.json();
  const storage = a.apiInfo.storageApi;
  let bucketId = storage.bucketId;
  if (!bucketId) bucketId = await findBucket(storage.apiUrl, a.authorizationToken, a.accountId, process.env.B2_BUCKET);
  // A key restricted to a name prefix can only write under it: "DISEXCLOVER" -> "DISEXCLOVER/".
  const prefix = storage.namePrefix ? storage.namePrefix.replace(/\/?$/, "/") : "";
  session = { apiUrl: storage.apiUrl, token: a.authorizationToken, bucketId, prefix, until: Date.now() + 20 * 3600e3 };
  return session;
}

async function findBucket(apiUrl, token, accountId, name) {
  const res = await fetch(`${apiUrl}/b2api/v3/b2_list_buckets`, {
    method: "POST",
    headers: { Authorization: token },
    body: JSON.stringify({ accountId, bucketName: name }),
  });
  if (!res.ok) throw new Error(`B2 list_buckets ${res.status}`);
  const bucket = (await res.json()).buckets[0];
  if (!bucket) throw new Error(`B2 bucket ${name} not found`);
  return bucket.bucketId;
}

// Uploads a buffer under `key` (inside the key's prefix, if any) and returns the B2 file
// name. One upload URL per call keeps it simple; photos are few.
async function upload(key, body, contentType) {
  const s = await authorize();
  const name = `${s.prefix}${key}`;
  const res = await fetch(`${s.apiUrl}/b2api/v3/b2_get_upload_url`, {
    method: "POST",
    headers: { Authorization: s.token },
    body: JSON.stringify({ bucketId: s.bucketId }),
  });
  if (!res.ok) throw new Error(`B2 get_upload_url ${res.status}`);
  const target = await res.json();
  const put = await fetch(target.uploadUrl, {
    method: "POST",
    headers: {
      Authorization: target.authorizationToken,
      "X-Bz-File-Name": encodeURIComponent(name).replace(/%2F/g, "/"),
      "Content-Type": contentType || "b2/x-auto",
      "X-Bz-Content-Sha1": crypto.createHash("sha1").update(body).digest("hex"),
    },
    body,
    signal: AbortSignal.timeout(120_000),
  });
  if (!put.ok) throw new Error(`B2 upload ${put.status} ${(await put.text()).slice(0, 200)}`);
  return name;
}

const fileName = async (key) => `${(await authorize()).prefix}${key}`;

const enabled = () => Boolean(process.env.B2_KEY_ID && process.env.B2_APPLICATION_KEY && process.env.B2_BUCKET);

module.exports = { enabled, upload, fileName };
