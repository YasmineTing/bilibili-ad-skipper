import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const dist = resolve("dist");
await rm(dist, { recursive: true, force: true });
console.log(`已清空构建目录：${dist}`);
