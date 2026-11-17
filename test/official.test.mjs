// lib/official.mjs 的测试：用临时文件喂「已登录 / 未登录 / 损坏」三种状态。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { maskUserId, pickUserId, readOfficialStatus } from "../lib/official.mjs";

test("maskUserId：长 id 掩成前6+…+后4，短 id 原样，空给空", () => {
  assert.equal(maskUserId("3ee2c0031804eb2aa70f7eb8d3cf8eb05778b8af9f43b844fb99a4b75b2af368"), "3ee2c0…f368");
  assert.equal(maskUserId("  user-abcdef-12345678  "), "user-a…5678");
  assert.equal(maskUserId("u_123"), "u_123"); // ≤10 位掩不住，原样
  assert.equal(maskUserId(""), "");
  assert.equal(maskUserId(null), "");
  assert.equal(maskUserId(42), "42");
});

test("pickUserId：按候选字段挑用户标识，machineId 不算", () => {
  assert.equal(pickUserId({ userId: "u-1234567890" }), "u-1234567890");
  assert.equal(pickUserId({ email: "me@example.com" }), "me@example.com");
  assert.equal(pickUserId({ uid: 42 }), "42");
  assert.equal(pickUserId({ machineId: "abc123", installedAt: "x" }), ""); // 设备标识不是登录
  assert.equal(pickUserId({ userId: "   " }), ""); // 空白串不算
  assert.equal(pickUserId(null), "");
});

test("readOfficialStatus：未登录 / 已登录 / 文件缺失 / 损坏 四种状态", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "magpie-tokentracker-official-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // 未登录：1.5.22 实测的字段集合
  const loggedOut = path.join(dir, "logged-out.json");
  await writeFile(
    loggedOut,
    JSON.stringify({
      installedAt: "2026-11-16T14:04:31.533Z",
      baseUrl: "https://example.insforge.app",
      machineId: "3ee2c0031804eb2aa70f7eb8d3cf8eb05778b8af9f43b844fb99a4b75b2af368",
    }),
  );
  assert.deepEqual(await readOfficialStatus(loggedOut), { loggedIn: false, userId: "" });

  // 已登录：带 userId
  const loggedIn = path.join(dir, "logged-in.json");
  await writeFile(
    loggedIn,
    JSON.stringify({ installedAt: "x", userId: "8f3e21a9c07d5542", machineId: "abc" }),
  );
  assert.deepEqual(await readOfficialStatus(loggedIn), { loggedIn: true, userId: "8f3e21…5542" });

  // 文件缺失 → 未登录
  const missing = await readOfficialStatus(path.join(dir, "nope.json"));
  assert.deepEqual(missing, { loggedIn: false, userId: "" });

  // 损坏 JSON → 未登录，不抛异常
  const broken = path.join(dir, "broken.json");
  await writeFile(broken, "{ not json");
  assert.deepEqual(await readOfficialStatus(broken), { loggedIn: false, userId: "" });
});
