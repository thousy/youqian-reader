// 轻量原生 WebDAV 客户端 - 支持坚果云、Nextcloud、群晖/自建 NAS WebDAV 同步

function getAuthHeader(username, password) {
  if (!username) return {}
  const token = Buffer.from(`${username}:${password || ''}`).toString('base64')
  return {
    'Authorization': `Basic ${token}`
  }
}

function normalizeBaseUrl(url) {
  let clean = (url || '').trim()
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    clean = 'https://' + clean
  }
  return clean.replace(/\/+$/, '')
}

/**
 * 确保远程目录存在 (如果不存在则调用 MKCOL 创建)
 */
async function ensureRemoteDir(baseUrl, authHeader) {
  const dirUrl = `${baseUrl}/YouQianReader/`
  try {
    const checkRes = await fetch(dirUrl, {
      method: 'PROPFIND',
      headers: {
        ...authHeader,
        'Depth': '0'
      }
    })

    if (checkRes.status === 404) {
      // 尝试创建目录
      await fetch(dirUrl, {
        method: 'MKCOL',
        headers: authHeader
      })
    }
  } catch (e) {
    console.warn('[WebDAV] 检查/创建远程目录警告:', e.message)
  }
}

/**
 * 测试 WebDAV 连通性
 */
export async function testWebdavConnection({ url, username, password }) {
  try {
    const baseUrl = normalizeBaseUrl(url)
    if (!baseUrl) {
      return { success: false, error: 'WebDAV 服务器地址不能为空' }
    }

    const authHeader = getAuthHeader(username, password)
    const res = await fetch(baseUrl, {
      method: 'PROPFIND',
      headers: {
        ...authHeader,
        'Depth': '0'
      }
    })

    if (res.status === 401 || res.status === 403) {
      return { success: false, error: '账号或应用密码错误 (HTTP ' + res.status + ')' }
    }

    if (res.status === 200 || res.status === 207 || res.status === 405) {
      // 顺便确保 /YouQianReader 目录就绪
      await ensureRemoteDir(baseUrl, authHeader)
      return { success: true }
    }

    return { success: false, error: `服务器返回状态异常: HTTP ${res.status} ${res.statusText}` }
  } catch (e) {
    return { success: false, error: '无法连接到 WebDAV 服务器: ' + e.message }
  }
}

/**
 * 上传备份至 WebDAV
 */
export async function uploadBackupToWebdav({ url, username, password }, backupData) {
  try {
    const baseUrl = normalizeBaseUrl(url)
    const authHeader = getAuthHeader(username, password)

    await ensureRemoteDir(baseUrl, authHeader)

    const targetUrl = `${baseUrl}/YouQianReader/youqian_backup.json`
    const bodyText = JSON.stringify(backupData, null, 2)

    const res = await fetch(targetUrl, {
      method: 'PUT',
      headers: {
        ...authHeader,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: bodyText
    })

    if (res.status === 200 || res.status === 201 || res.status === 204) {
      return { success: true, uploadedAt: new Date().toISOString() }
    }

    return { success: false, error: `上传失败: HTTP ${res.status} ${res.statusText}` }
  } catch (e) {
    return { success: false, error: '上传至 WebDAV 失败: ' + e.message }
  }
}

/**
 * 从 WebDAV 下载备份
 */
export async function downloadBackupFromWebdav({ url, username, password }) {
  try {
    const baseUrl = normalizeBaseUrl(url)
    const authHeader = getAuthHeader(username, password)
    const targetUrl = `${baseUrl}/YouQianReader/youqian_backup.json`

    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        ...authHeader
      }
    })

    if (res.status === 404) {
      return { success: false, error: 'WebDAV 云端尚未找到任何备份文件 (youqian_backup.json)' }
    }

    if (res.status !== 200) {
      return { success: false, error: `下载云端备份失败: HTTP ${res.status} ${res.statusText}` }
    }

    const json = await res.json()
    return { success: true, backup: json }
  } catch (e) {
    return { success: false, error: '从 WebDAV 下载备份失败: ' + e.message }
  }
}
