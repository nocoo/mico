import assert from 'node:assert/strict'
import type { IncomingMessage } from 'node:http'
import test from 'node:test'
import { extractClientIp, isIpAllowed, normalizeIp, parseCidrList } from './ipAllowlist.ts'

function fakeReq(
	headers: Record<string, string | string[] | undefined>,
	remoteAddress?: string,
): IncomingMessage {
	return {
		headers,
		socket: { remoteAddress },
	} as unknown as IncomingMessage
}

test('normalizeIp handles ipv4 ports, ipv6 brackets, and ipv4-mapped ipv6', () => {
	assert.equal(normalizeIp('167.220.10.5:41234'), '167.220.10.5')
	assert.equal(normalizeIp('::ffff:167.220.10.5'), '167.220.10.5')
	assert.equal(normalizeIp('[2001:db8::1]:443'), '2001:db8::1')
	assert.equal(normalizeIp('not-an-ip'), undefined)
})

test('parseCidrList matches 167.220.0.0/16 and rejects outside ranges', () => {
	const ranges = parseCidrList('167.220.0.0/16')
	assert.equal(isIpAllowed('167.220.0.1', ranges), true)
	assert.equal(isIpAllowed('167.220.255.254', ranges), true)
	assert.equal(isIpAllowed('::ffff:167.220.12.34', ranges), true)
	assert.equal(isIpAllowed('167.221.0.1', ranges), false)
	assert.equal(isIpAllowed('10.0.0.1', ranges), false)
	assert.equal(isIpAllowed(undefined, ranges), false)
})

test('parseCidrList rejects invalid CIDRs and allows all when empty', () => {
	assert.equal(isIpAllowed('1.2.3.4', parseCidrList(undefined)), true)
	assert.equal(isIpAllowed('1.2.3.4', parseCidrList('')), true)
	assert.throws(() => parseCidrList('167.220.0.0/33'), /Invalid IPv4 CIDR/)
	assert.throws(() => parseCidrList('167.220.0.0/'), /Invalid IPv4 CIDR/)
	assert.throws(() => parseCidrList('invalid'), /Invalid IP/)
})

test('extractClientIp prefers x-envoy-external-address, then rightmost x-forwarded-for, then socket', () => {
	assert.equal(
		extractClientIp(
			fakeReq(
				{
					'x-envoy-external-address': '167.220.5.6',
					'x-forwarded-for': '8.8.8.8, 167.220.1.2',
				},
				'10.0.0.1',
			),
		),
		'167.220.5.6',
	)

	// Spoofed leftmost XFF entry must be ignored in favor of rightmost Envoy-appended hop
	assert.equal(
		extractClientIp(fakeReq({ 'x-forwarded-for': '167.220.1.1, 203.0.113.55:1234' }, '10.0.0.1')),
		'203.0.113.55',
	)

	assert.equal(extractClientIp(fakeReq({}, '::ffff:127.0.0.1')), '127.0.0.1')
})
