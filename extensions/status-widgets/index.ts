// Pi의 workspace/구독 상태 UI를 한곳에서 등록한다.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerUsageStatus from "./usage.ts";
import registerWorkspaceStatus from "./workspace.ts";

export default function statusWidgets(pi: ExtensionAPI) {
  const setWorkspaceProviderStatus = registerWorkspaceStatus(pi);
  registerUsageStatus(pi, setWorkspaceProviderStatus);
}
