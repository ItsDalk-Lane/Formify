/**
 * API 密钥加密/解密工具
 * 使用 XOR 加密算法和设备指纹生成主密码
 */

/**
 * 生成设备指纹作为加密密钥
 * 基于浏览器环境信息生成唯一标识
 */
export function generateDeviceFingerprint(): string {
	try {
		const userAgent = navigator.userAgent || 'unknown'
		const language = navigator.language || 'en-US'
		const platform = navigator.platform || 'unknown'
		const hardwareConcurrency = navigator.hardwareConcurrency || 4
		const screenResolution = `${window.screen.width}x${window.screen.height}`
		const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

		// 组合所有特征
		const fingerprint = `${userAgent}|${language}|${platform}|${hardwareConcurrency}|${screenResolution}|${timezone}`

		// 使用简单哈希算法生成密钥
		return simpleHash(fingerprint)
	} catch (error) {
		console.warn('[Crypto] 生成设备指纹失败，使用默认密钥', error)
		// 如果获取失败，使用一个固定的默认值
		return simpleHash('obsidian-tars-default-key')
	}
}

/**
 * 简单哈希算法
 * 将字符串转换为固定长度的哈希值
 */
function simpleHash(str: string): string {
	let hash = 0
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i)
		hash = (hash << 5) - hash + char
		hash = hash & hash // Convert to 32bit integer
	}
	// 转换为正数并转为16进制
	return Math.abs(hash).toString(16).padStart(8, '0')
}

/**
 * XOR 加密/解密（因为 XOR 是对称的）
 * @param data 要加密/解密的数据
 * @param key 密钥
 */
function xorCipher(data: Uint8Array, key: string): Uint8Array {
	const result = new Uint8Array(data.length)
	const keyBytes = new TextEncoder().encode(key)

	for (let i = 0; i < data.length; i++) {
		result[i] = data[i] ^ keyBytes[i % keyBytes.length]
	}

	return result
}

/**
 * 将字节数组转换为十六进制字符串
 */
function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
}

/**
 * 将十六进制字符串转换为字节数组
 */
function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2)
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
	}
	return bytes
}

/**
 * 检查字符串是否为十六进制格式
 */
function isHexString(str: string): boolean {
	return /^[0-9a-fA-F]+$/.test(str) && str.length % 2 === 0
}

/**
 * 检查字符串是否为 Base64 格式
 */
function isBase64String(str: string): boolean {
	try {
		// Base64 字符集检查
		if (!/^[A-Za-z0-9+/]*={0,2}$/.test(str)) {
			return false
		}
		// 长度必须是 4 的倍数
		if (str.length % 4 !== 0) {
			return false
		}
		// 尝试解码验证
		atob(str)
		return true
	} catch {
		return false
	}
}

/**
 * 验证解密后的 API 密钥是否有效
 */
function validateApiKey(key: string): boolean {
	// 基本检查
	if (!key || key.length < 10) {
		return false
	}

	// 检查是否包含过多控制字符
	const controlChars = key.match(/[\x00-\x1F\x7F]/g)
	if (controlChars && controlChars.length > key.length * 0.2) {
		return false
	}

	// 检查是否为可打印字符
	const printableChars = key.match(/[a-zA-Z0-9\-_\.]/g)
	if (!printableChars || printableChars.length < key.length * 0.5) {
		return false
	}

	return true
}

/**
 * 加密 API 密钥
 * @param apiKey 明文 API 密钥
 * @returns 加密后的字符串
 */
export function encryptApiKey(apiKey: string): string {
	if (!apiKey || apiKey.trim().length === 0) {
		return apiKey
	}

	try {
		const masterKey = generateDeviceFingerprint()

		// 方案1: XOR 加密 + 十六进制编码
		try {
			const dataBytes = new TextEncoder().encode(apiKey)
			const encryptedBytes = xorCipher(dataBytes, masterKey)
			const hexString = bytesToHex(encryptedBytes)

			console.debug('[Crypto] API 密钥已使用 XOR 加密')
			return hexString
		} catch (xorError) {
			console.warn('[Crypto] XOR 加密失败，尝试 Base64 方案', xorError)
		}

		// 方案2: Base64 编码（后备方案）
		try {
			const dataBytes = new TextEncoder().encode(apiKey)
			const encryptedBytes = xorCipher(dataBytes, masterKey)
			const base64String = btoa(String.fromCharCode(...encryptedBytes))

			console.debug('[Crypto] API 密钥已使用 Base64 加密')
			return base64String
		} catch (base64Error) {
			console.warn('[Crypto] Base64 加密失败', base64Error)
		}

		// 方案3: 如果所有加密方法都失败，返回原始密钥
		console.warn('[Crypto] 所有加密方法失败，保存原始密钥')
		return apiKey
	} catch (error) {
		console.error('[Crypto] 加密过程发生错误', error)
		return apiKey
	}
}

/**
 * 解密 API 密钥
 * @param encryptedKey 加密的 API 密钥
 * @returns 解密后的明文密钥
 */
export function decryptApiKey(encryptedKey: string): string {
	if (!encryptedKey || encryptedKey.trim().length === 0) {
		return encryptedKey
	}

	try {
		const masterKey = generateDeviceFingerprint()

		// 检测加密格式
		if (isHexString(encryptedKey)) {
			// 十六进制格式 (XOR 加密)
			try {
				const encryptedBytes = hexToBytes(encryptedKey)
				const decryptedBytes = xorCipher(encryptedBytes, masterKey)
				const decrypted = new TextDecoder().decode(decryptedBytes)

				if (validateApiKey(decrypted)) {
					console.debug('[Crypto] API 密钥已使用十六进制格式解密')
					return decrypted
				}
			} catch (hexError) {
				console.warn('[Crypto] 十六进制解密失败', hexError)
			}
		}

		if (isBase64String(encryptedKey)) {
			// Base64 格式
			try {
				// 尝试方案1: XOR 解密
				const decoded = atob(encryptedKey)
				const encryptedBytes = new Uint8Array(decoded.length)
				for (let i = 0; i < decoded.length; i++) {
					encryptedBytes[i] = decoded.charCodeAt(i)
				}
				const decryptedBytes = xorCipher(encryptedBytes, masterKey)
				const decrypted = new TextDecoder().decode(decryptedBytes)

				if (validateApiKey(decrypted)) {
					console.debug('[Crypto] API 密钥已使用 Base64 格式解密')
					return decrypted
				}
			} catch (base64Error) {
				console.warn('[Crypto] Base64 解密失败', base64Error)
			}

			// 尝试方案2: 直接 Base64 解码（兼容旧数据）
			try {
				const decoded = atob(encryptedKey)
				if (validateApiKey(decoded)) {
					console.debug('[Crypto] API 密钥使用纯 Base64 解码')
					return decoded
				}
			} catch {
				// 忽略
			}
		}

		// 如果解密失败，假设是明文密钥（向后兼容）
		if (validateApiKey(encryptedKey)) {
			console.debug('[Crypto] 检测到明文 API 密钥')
			return encryptedKey
		}

		// 解密失败但格式不明，仍然返回原值
		console.warn('[Crypto] 无法解密 API 密钥，返回原始值')
		return encryptedKey
	} catch (error) {
		console.error('[Crypto] 解密过程发生错误', error)
		return encryptedKey
	}
}

/**
 * 隐藏 API 密钥显示
 * @param apiKey API 密钥
 * @param visibleLength 显示的字符数（前后各显示的数量）
 * @returns 隐藏后的字符串
 */
export function maskApiKey(apiKey: string, visibleLength: number = 4): string {
	if (!apiKey || apiKey.length <= visibleLength * 2) {
		return apiKey.replace(/./g, '*')
	}

	const start = apiKey.substring(0, visibleLength)
	const end = apiKey.substring(apiKey.length - visibleLength)
	const masked = '*'.repeat(Math.max(8, apiKey.length - visibleLength * 2))

	return `${start}${masked}${end}`
}
