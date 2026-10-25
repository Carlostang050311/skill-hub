import { cache } from "react";
import { defaultRoots, type ScanResult } from "@skillhub/core";
import { inventoryDbPath, readInventory, type StoredScan } from "@skillhub/storage";
import { skillhubHome } from "./paths";

/** 按请求读取共享 inventory.db；没有快照时才执行首次扫描。 */
export const getInventory = cache((): StoredScan => {
  const home = skillhubHome();
  return readInventory(defaultRoots(home), inventoryDbPath(home), { refresh: false });
});

export const getScan = cache((): ScanResult => getInventory().result);

/** 写入 Skill 后显式刷新当前库存，避免页面继续展示旧快照。 */
export function refreshInventory(): StoredScan {
  const home = skillhubHome();
  return readInventory(defaultRoots(home), inventoryDbPath(home), { refresh: true });
}
