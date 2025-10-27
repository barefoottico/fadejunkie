function withCORS(handler) {
  return async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(204).end();
    return handler(req, res);
  };
}

export default withCORS(async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  const token = process.env.GITHUB_TOKEN;
  const repoOwner = process.env.REPO_OWNER || "barefoottico";
  const repoName  = process.env.REPO_NAME  || "fadejunkie";
  const baseBranch = process.env.BASE_BRANCH || "main";
  if (!token) return res.status(500).send("Missing GITHUB_TOKEN");
  const payload = req.body;
  if (!payload?.shop?.id) return res.status(400).send("Missing shop payload");

  try {
    // get base branch head sha
    const baseRef = await gh(`repos/${repoOwner}/${repoName}/git/ref/heads/${baseBranch}`, token);
    const baseSha = baseRef.object.sha;
    const branch = `onboard/${payload.shop.id}`;

    // create branch from base
    await gh(`repos/${repoOwner}/${repoName}/git/refs`, token, "POST", {
      ref: `refs/heads/${branch}`, sha: baseSha
    });

    // write files into the branch
    const files = [
      { path: `data/shops/${payload.shop.id}.json`, content: JSON.stringify(payload.shop, null, 2) },
      { path: `data/barbers/${payload.shop.id}.json`, content: JSON.stringify(payload.barbers || [], null, 2) }
    ];

    for (const f of files) {
      await gh(`repos/${repoOwner}/${repoName}/contents/${encodeURIComponent(f.path)}`, token, "PUT", {
        message: `feat: onboard ${payload.shop.name} (${f.path})`,
        content: Buffer.from(f.content, "utf8").toString("base64"),
        branch
      });
    }

    // open PR
    const pr = await gh(`repos/${repoOwner}/${repoName}/pulls`, token, "POST", {
      title: `Onboard shop: ${payload.shop.name}`,
      head: branch,
      base: baseBranch,
      body: `Automated onboarding for **${payload.shop.name}**\n\nShop ID: \`${payload.shop.id}\`\nImages hosted in Firebase Storage`
    });

    res.json({ ok: true, prUrl: pr.html_url });
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message || "Internal error");
  }
});

async function gh(path, token, method = "GET", body) {
  const r = await fetch(`https://api.github.com/${path}`, {
    method,
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json" },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

