import type { IncomingMessage } from 'node:http'
import { isIP } from 'node:net'

export type CidrRange =
	| { family: 4; network: number; mask: number }
	| { family: 6; network: bigint; mask: bigint }

function parseIpv4(ip: string): number {
	const parts = ip.split('.')
	let value = 0
	for (const part of parts) {
		value = (value << 8) | Number(part)
	}
	return value >>> 0
}

function expandIpv6(ip: string): bigint {
	let target = ip.toLowerCase()
	const zoneIndex = target.indexOf('%')
	if (zoneIndex >= 0) target = target.slice(0, zoneIndex)

	const [head, tail] = target.split('::')
	const headGroups = head ? head.split(':').filter(Boolean) : []
	const tailGroups = tail !== undefined ? tail.split(':').filter(Boolean) : []

	const parseGroup = (group: string): number[] => {
		if (group.includes('.')) {
			const v4 = parseIpv4(group)
			return [(v4 >>> 16) & 0xffff, v4 & 0xffff]
		}
		return [Number.parseInt(group, 16)]
	}

	const expandedHead = headGroups.flatMap(parseGroup)
	const expandedTail = tailGroups.flatMap(parseGroup)
	const missing = 8 - expandedHead.length - expandedTail.length
	const groups = [
		...expandedHead,
		...Array.from({ length: Math.max(0, missing) }, () => 0),
		...expandedTail,
	]

	let result = 0n
	for (const group of groups) {
		result = (result << 16n) | BigInt(group)
	}
	return result
}

export function normalizeIp(raw: string | undefined): string | undefined {
	if (!raw) return undefined
	let value = raw.trim()
	if (!value) return undefined

	if (value.startsWith('[')) {
		const endBracket = value.indexOf(']')
		if (endBracket > 1) value = value.slice(1, endBracket)
	} else {
		const lastColon = value.lastIndexOf(':')
		if (lastColon > 0 && value.indexOf(':') === lastColon && value.includes('.')) {
			value = value.slice(0, lastColon)
		}
	}

	if (value.toLowerCase().startsWith('::ffff:')) {
		const mapped = value.slice(7)
		if (isIP(mapped) === 4) return mapped
	}

	return isIP(value) !== 0 ? value : undefined
}

export function parseCidr(raw: string): CidrRange {
	const trimmed = raw.trim()
	if (!trimmed) throw new Error('CIDR entry cannot be empty')
	const slash = trimmed.indexOf('/')
	const ipPart = slash >= 0 ? trimmed.slice(0, slash).trim() : trimmed
	const prefixPart = slash >= 0 ? trimmed.slice(slash + 1).trim() : undefined

	const normalized = normalizeIp(ipPart)
	if (!normalized) throw new Error(`Invalid IP address in CIDR: ${trimmed}`)

	const family = isIP(normalized)
	if (family === 4) {
		const prefix = prefixPart === undefined ? 32 : Number(prefixPart)
		if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32 || prefixPart === '') {
			throw new Error(`Invalid IPv4 CIDR prefix: ${trimmed}`)
		}
		const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
		return { family: 4, network: (parseIpv4(normalized) & mask) >>> 0, mask }
	}

	if (family === 6) {
		const prefix = prefixPart === undefined ? 128 : Number(prefixPart)
		if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128 || prefixPart === '') {
			throw new Error(`Invalid IPv6 CIDR prefix: ${trimmed}`)
		}
		const fullMask = (1n << 128n) - 1n
		const mask = prefix === 0 ? 0n : (fullMask << BigInt(128 - prefix)) & fullMask
		return { family: 6, network: expandIpv6(normalized) & mask, mask }
	}

	throw new Error(`Unsupported IP address family: ${trimmed}`)
}

export function parseCidrList(raw: string | undefined): CidrRange[] {
	const trimmed = raw?.trim()
	if (!trimmed) return []
	return trimmed.split(',').map((entry) => parseCidr(entry))
}

export function extractClientIp(req: IncomingMessage): string | undefined {
	const envoyExternal = req.headers['x-envoy-external-address']
	if (typeof envoyExternal === 'string') {
		const ip = normalizeIp(envoyExternal)
		if (ip) return ip
	}

	const forwardedFor = req.headers['x-forwarded-for']
	const forwardedValues = Array.isArray(forwardedFor)
		? forwardedFor
		: typeof forwardedFor === 'string'
			? [forwardedFor]
			: []
	for (let i = forwardedValues.length - 1; i >= 0; i -= 1) {
		const parts = forwardedValues[i].split(',')
		for (let j = parts.length - 1; j >= 0; j -= 1) {
			const ip = normalizeIp(parts[j])
			if (ip) return ip
		}
	}

	return normalizeIp(req.socket?.remoteAddress)
}

export function isIpAllowed(ip: string | undefined, ranges: readonly CidrRange[]): boolean {
	if (ranges.length === 0) return true
	const normalized = normalizeIp(ip)
	if (!normalized) return false

	const family = isIP(normalized)
	if (family === 4) {
		const addr = parseIpv4(normalized)
		return ranges.some((range) => range.family === 4 && (addr & range.mask) >>> 0 === range.network)
	}
	if (family === 6) {
		const addr = expandIpv6(normalized)
		return ranges.some((range) => range.family === 6 && (addr & range.mask) === range.network)
	}
	return false
}
