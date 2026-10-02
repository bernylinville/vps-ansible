const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {test} = require('node:test');
const checkCumoraImage = require('./check-cumora-image.cjs');

const revision = 'a'.repeat(40);
const oldImage = `ghcr.io/bernylinville/cumora-server@sha256:${'b'.repeat(64)}`;
const index = {schemaVersion: 2, manifests: [{platform: {os: 'linux', architecture: 'amd64'}}]};
const bytes = Buffer.from(JSON.stringify(index));
const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const newImage = `ghcr.io/bernylinville/cumora-server@${digest}`;

async function fixture(t, {image = oldImage, builds, responseBytes = bytes, responseDigest = digest} = {}) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'cumora-image-test-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const defaultsPath = join(directory, 'main.yml');
  const original = `---\ncumora_image: ${image}\ncumora_waitlist_enabled: true\n`;
  await fs.writeFile(defaultsPath, original);
  const outputs = {};
  const requests = [];
  const successful = {head_sha: revision, head_branch: 'main', event: 'push', conclusion: 'success', html_url: 'https://github.com/bernylinville/cumora/actions/runs/1'};
  return {
    defaultsPath, original, outputs, requests,
    github: {rest: {
      repos: {getCommit: async () => ({data: {sha: revision}})},
      actions: {listWorkflowRuns: async request => {
        assert.equal(request.head_sha, revision);
        assert.equal(request.workflow_id, 'ghcr.yml');
        return {data: {workflow_runs: builds ?? [successful]}};
      }},
    }},
    core: {info() {}, setOutput(key, value) {outputs[key] = value;}},
    fetchImpl: async (url, options) => {
      requests.push({url, options});
      if (requests.length === 1) return {ok: true, json: async () => ({token: 'test-pull-token'})};
      assert.equal(url, `https://ghcr.io/v2/bernylinville/cumora-server/manifests/sha-${revision}`);
      assert.equal(options.headers.Authorization, 'Bearer test-pull-token');
      return {ok: true, headers: new Headers({'docker-content-digest': responseDigest}), arrayBuffer: async () => responseBytes};
    },
  };
}

test('successful published main build updates only the immutable image declaration', async t => {
  const f = await fixture(t);
  assert.deepEqual(await checkCumoraImage(f), {changed: true, image: newImage, revision});
  assert.equal(await fs.readFile(f.defaultsPath, 'utf8'), f.original.replace(oldImage, newImage));
  assert.equal(f.requests[0].options.headers, undefined);
  assert.equal(f.outputs.changed, true);
});

test('same digest is a no-op', async t => {
  const f = await fixture(t, {image: newImage});
  assert.equal((await checkCumoraImage(f)).changed, false);
  assert.equal(await fs.readFile(f.defaultsPath, 'utf8'), f.original);
});

test('pending, failed, old or PR builds never propose a deployment', async t => {
  for (const builds of [[], [{head_sha: revision, head_branch: 'main', event: 'push', conclusion: 'failure'}],
    [{head_sha: 'c'.repeat(40), head_branch: 'main', event: 'push', conclusion: 'success'}],
    [{head_sha: revision, head_branch: 'main', event: 'pull_request', conclusion: 'success'}]]) {
    const f = await fixture(t, {builds});
    assert.deepEqual(await checkCumoraImage(f), {changed: false});
    assert.equal(f.requests.length, 0);
    assert.equal(await fs.readFile(f.defaultsPath, 'utf8'), f.original);
  }
});

test('registry errors, digest mismatch and unsupported platform fail without editing defaults', async t => {
  const badDigest = await fixture(t, {responseDigest: `sha256:${'c'.repeat(64)}`});
  await assert.rejects(checkCumoraImage(badDigest), /digest does not match/);
  assert.equal(await fs.readFile(badDigest.defaultsPath, 'utf8'), badDigest.original);
  const arm = Buffer.from(JSON.stringify({schemaVersion: 2, manifests: [{platform: {os: 'linux', architecture: 'arm64'}}]}));
  const wrongPlatform = await fixture(t, {responseBytes: arm, responseDigest: `sha256:${createHash('sha256').update(arm).digest('hex')}`});
  await assert.rejects(checkCumoraImage(wrongPlatform), /no linux\/amd64/);
  assert.equal(await fs.readFile(wrongPlatform.defaultsPath, 'utf8'), wrongPlatform.original);
  const denied = await fixture(t);
  denied.fetchImpl = async () => ({ok: false, status: 403});
  await assert.rejects(checkCumoraImage(denied), /HTTP 403/);
  assert.equal(await fs.readFile(denied.defaultsPath, 'utf8'), denied.original);
});

test('invalid or duplicate image declarations are not rewritten', async t => {
  const invalid = await fixture(t, {image: 'ghcr.io/bernylinville/cumora-server:latest'});
  await assert.rejects(checkCumoraImage(invalid), /exactly one immutable/);
  assert.equal(await fs.readFile(invalid.defaultsPath, 'utf8'), invalid.original);
  const duplicate = await fixture(t);
  const before = duplicate.original + `cumora_image: ${oldImage}\n`;
  await fs.writeFile(duplicate.defaultsPath, before);
  await assert.rejects(checkCumoraImage(duplicate), /exactly one immutable/);
  assert.equal(await fs.readFile(duplicate.defaultsPath, 'utf8'), before);
});
