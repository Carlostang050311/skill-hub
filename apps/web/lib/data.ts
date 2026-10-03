import { cache } from "react";
import { defaultRoots, scanAll, type ScanResult } from "@skillhub/core";

/** 按请求缓存的实时扫描：本地 300 个 skill 扫描在 1 秒内，无需持久化层 */
export const getScan = cache((): ScanResult => scanAll(defaultRoots()));
