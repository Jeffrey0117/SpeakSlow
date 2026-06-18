export function shouldEnableStreamingMode(settingEnabled, streamingModelStatus, runtimeInfo) {
  if (settingEnabled !== true) return false;
  if (runtimeInfo?.platform !== "darwin") return false;
  return streamingModelStatus?.success === true && streamingModelStatus?.models_downloaded === true;
}

export async function resolveStreamingModeAvailability(settingEnabled, runtimeInfo, api) {
  if (settingEnabled !== true) {
    return { enabled: false, downloaded: false, status: null };
  }
  if (runtimeInfo?.platform !== "darwin") {
    return { enabled: false, downloaded: false, unsupported: true, status: null };
  }

  const status = await api?.checkStreamingModelFiles?.();
  if (shouldEnableStreamingMode(settingEnabled, status, runtimeInfo)) {
    return { enabled: true, downloaded: false, status };
  }
  if (status?.unsupported) {
    return { enabled: false, downloaded: false, unsupported: true, status };
  }
  if (status?.success !== true || typeof api?.downloadStreamingModel !== "function") {
    return { enabled: false, downloaded: false, status };
  }

  const downloadResult = await api.downloadStreamingModel();
  if (!downloadResult?.success) {
    return { enabled: false, downloaded: false, status, downloadResult };
  }

  const nextStatus = await api.checkStreamingModelFiles?.();
  return {
    enabled: shouldEnableStreamingMode(settingEnabled, nextStatus, runtimeInfo),
    downloaded: true,
    status: nextStatus,
    downloadResult,
  };
}
