const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');

// Resolve only a successfully published main build. This script changes one local
// declaration; create-pull-request handles the proposal, never production rollout.
module.exports = async function checkCumoraImage({github, core, fetchImpl = fetch,
  defaultsPath = 'roles/cumora/defaults/main.yml'}) {
  const source = {owner: 'bernylinville', repo: 'cumora'};
  const {data: commit} = await github.rest.repos.getCommit({...source, ref: 'main'});
  const revision = commit.sha;
  if (!/^[0-9a-f]{40}$/.test(revision || '')) throw new Error('Invalid source main SHA');
  const {data: builds} = await github.rest.actions.listWorkflowRuns({
    ...source, workflow_id: 'ghcr.yml', branch: 'main', event: 'push', status: 'success', head_sha: revision, per_page: 1,
  });
  const build = builds.workflow_runs.find(run => run.head_sha === revision && run.head_branch === 'main'
    && run.event === 'push' && run.conclusion === 'success');
  if (!build) {
    core.info('Current source main has no successful GHCR build yet; keeping the deployed digest.');
    core.setOutput('changed', false);
    return {changed: false};
  }

  // Anonymous GHCR access: never send the repository GITHUB_TOKEN to the registry.
  const repository = 'bernylinville/cumora-server';
  const auth = await fetchImpl(`https://ghcr.io/token?service=ghcr.io&scope=repository:${repository}:pull`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!auth.ok) throw new Error(`Anonymous GHCR authorization failed: HTTP ${auth.status}`);
  const {token} = await auth.json();
  if (typeof token !== 'string' || !token) throw new Error('GHCR returned no pull token');
  const response = await fetchImpl(`https://ghcr.io/v2/${repository}/manifests/sha-${revision}`, {
    headers: {Authorization: `Bearer ${token}`, Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json'},
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Published image lookup failed: HTTP ${response.status}`);
  const manifestBytes = Buffer.from(await response.arrayBuffer());
  const digest = response.headers.get('docker-content-digest');
  if (digest !== `sha256:${createHash('sha256').update(manifestBytes).digest('hex')}`) {
    throw new Error('Registry manifest digest does not match its content');
  }
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.manifests)
    || !manifest.manifests.some(item => item.platform?.os === 'linux' && item.platform?.architecture === 'amd64')) {
    throw new Error('Published image index has no linux/amd64 image');
  }
  const image = `ghcr.io/${repository}@${digest}`;
  const text = await fs.readFile(defaultsPath, 'utf8');
  const declarations = [...text.matchAll(/^cumora_image:[ \t]*(\S+)[ \t]*$/gm)];
  if (declarations.length !== 1
    || !/^ghcr\.io\/bernylinville\/cumora-server@sha256:[0-9a-f]{64}$/.test(declarations[0][1])) {
    throw new Error('Expected exactly one immutable Cumora image declaration; refusing to rewrite the file');
  }
  const changed = declarations[0][1] !== image;
  if (changed) await fs.writeFile(defaultsPath, text.replace(declarations[0][0], `cumora_image: ${image}`));
  core.setOutput('changed', changed);
  core.setOutput('image', image);
  core.setOutput('source_sha', revision);
  core.setOutput('build_url', build.html_url);
  core.info(changed ? `Proposing image ${image}` : 'The deployed image declaration is already current.');
  return {changed, image, revision};
};
