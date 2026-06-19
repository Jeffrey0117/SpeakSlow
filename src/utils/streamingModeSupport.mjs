export function shouldEnableStreamingMode(settingEnabled, streamingModelStatus, runtimeInfo) {
  if (settingEnabled !== true) return false;
  // 串流不再限定 macOS:平台是否支援交由後端 checkStreamingModelFiles 回報
  // （unsupported 旗標）決定,前端只看「設定有開 + 模型已就緒」。
  return streamingModelStatus?.success === true && streamingModelStatus?.models_downloaded === true;
}

export async function resolveStreamingModeAvailability(settingEnabled, runtimeInfo, api) {
  if (settingEnabled !== true) {
    return { enabled: false, downloaded: false, status: null };
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
