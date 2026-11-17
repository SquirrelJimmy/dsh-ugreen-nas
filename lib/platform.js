const PLATFORM_MAP = {
  darwin: { name: 'darwin', x64: 'amd64', arm64: 'arm64' },
  linux: { name: 'linux', x64: 'amd64', arm64: 'arm64' },
  win32: { name: 'windows', x64: 'amd64', arm64: 'arm64' },
}

export function detectPlatform(platform = process.platform, arch = process.arch) {
  const platformMap = PLATFORM_MAP[platform]
  const normalizedArch = platformMap?.[arch]
  if (!normalizedArch) {
    const error = new Error(`Unsupported platform: ${platform}/${arch}`)
    error.code = 'UNSUPPORTED_PLATFORM'
    throw error
  }

  const isZip = platform === 'win32'
  return {
    os: platform,
    arch: normalizedArch,
    platformName: `${platformMap.name}-${normalizedArch}`,
    binaryName: isZip ? 'unc.exe' : 'unc',
    isZip,
  }
}

export function artifactName(platformInfo, version) {
  const tag = String(version).startsWith('v') ? String(version) : `v${version}`
  const extension = platformInfo.isZip ? 'zip' : 'tar.gz'
  return `unc-${tag}-${platformInfo.platformName}.${extension}`
}

export function skillsArtifactName(version) {
  const tag = String(version).startsWith('v') ? String(version) : `v${version}`
  return `unc-skills-${tag}.zip`
}
