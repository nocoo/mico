import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { azureOrigin, azureTarget, containerApp } from './cloud/azure.ts'

const command = process.argv[2]
if (!['plan', 'provision', 'build', 'deploy'].includes(command ?? '')) {
	console.error('Usage: node scripts/deploy-azure.ts plan|provision|build|deploy')
	process.exit(1)
}
const target = azureTarget(process.env)

function run(binary: string, args: string[], capture = true): string {
	const result = spawnSync(binary, args, {
		encoding: 'utf8',
		stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
		maxBuffer: 16 * 1024 * 1024,
		timeout: 30 * 60 * 1000,
	})
	if (result.error || result.status !== 0) {
		if (result.stderr) console.error(result.stderr.trim())
		throw new Error(`${binary} ${args.slice(0, 2).join(' ')} failed`)
	}
	return result.stdout?.trim() ?? ''
}

function az<T>(args: string[]): T {
	const output = run('az', [
		...args,
		'--subscription',
		target.subscriptionId,
		'--only-show-errors',
		'--output',
		'json',
	])
	return (output ? JSON.parse(output) : undefined) as T
}

function preflight(): void {
	const account = az<{ tenantId: string; state: string }>(['account', 'show'])
	if (account.tenantId !== target.tenantId || account.state !== 'Enabled') {
		throw new Error('Configured subscription does not match the resource tenant or is disabled')
	}
	const group = az<{ location: string }>(['group', 'show', '-n', target.resourceGroup])
	if (group.location !== target.location) {
		throw new Error('Resource group location differs from MICO_AZ_LOCATION')
	}
}

function revision(): string {
	if (run('git', ['status', '--porcelain', '--untracked-files=no'])) {
		throw new Error('Commit all tracked changes before building or deploying')
	}
	return run('git', ['rev-parse', 'HEAD'])
}

function resources() {
	return az<Array<{ name: string; type: string; location: string }>>([
		'resource',
		'list',
		'-g',
		target.resourceGroup,
	])
}

function provision(): void {
	const existing = resources()
	const ensure = (name: string, type: string, args: string[]) => {
		const resource = existing.find((item) => item.name === name && item.type === type)
		if (resource && resource.location !== target.location)
			throw new Error('Existing resource region mismatch')
		if (!resource) az(args)
	}
	const scope = ['-g', target.resourceGroup, '-l', target.location]
	ensure(target.identity, 'Microsoft.ManagedIdentity/userAssignedIdentities', [
		'identity',
		'create',
		'-n',
		target.identity,
		...scope,
	])
	ensure(target.registry, 'Microsoft.ContainerRegistry/registries', [
		'acr',
		'create',
		'-n',
		target.registry,
		...scope,
		'--sku',
		'Basic',
		'--admin-enabled',
		'false',
	])
	const identity = az<{ principalId: string }>([
		'identity',
		'show',
		'-g',
		target.resourceGroup,
		'-n',
		target.identity,
	])
	const registry = az<{ id: string; adminUserEnabled: boolean }>([
		'acr',
		'show',
		'-g',
		target.resourceGroup,
		'-n',
		target.registry,
	])
	if (registry.adminUserEnabled) throw new Error('Registry admin access must be disabled')
	const roles = az<Array<{ principalId: string }>>([
		'role',
		'assignment',
		'list',
		'--scope',
		registry.id,
		'--role',
		'AcrPull',
		'--fill-principal-name',
		'false',
	])
	if (!roles.some((role) => role.principalId === identity.principalId)) {
		az([
			'role',
			'assignment',
			'create',
			'--assignee-object-id',
			identity.principalId,
			'--assignee-principal-type',
			'ServicePrincipal',
			'--role',
			'AcrPull',
			'--scope',
			registry.id,
		])
	}
	ensure(target.environment, 'Microsoft.App/managedEnvironments', [
		'containerapp',
		'env',
		'create',
		'-n',
		target.environment,
		...scope,
		'--logs-destination',
		'none',
	])
	const environment = az<{ properties: { defaultDomain: string } }>([
		'containerapp',
		'env',
		'show',
		'-g',
		target.resourceGroup,
		'-n',
		target.environment,
	])
	console.log(`Origin: ${azureOrigin(target, environment.properties.defaultDomain)}`)
	if (target.authMode === 'entra')
		console.log(
			`SPA callback: ${azureOrigin(target, environment.properties.defaultDomain)}/auth/callback`,
		)
}

function build(): void {
	const sha = revision()
	const registry = az<{ loginServer: string }>([
		'acr',
		'show',
		'-g',
		target.resourceGroup,
		'-n',
		target.registry,
	])
	const image = `${registry.loginServer}/mico:${sha}`
	const directory = mkdtempSync(join(tmpdir(), 'mico-azure-build-'))
	try {
		const archive = join(directory, 'source.tar')
		run('git', ['archive', '--format=tar', `--output=${archive}`, sha])
		run('tar', ['-xf', archive, '-C', directory])
		rmSync(archive)
		run(
			'docker',
			[
				'build',
				'--platform',
				'linux/amd64',
				'--build-arg',
				`NPM_REGISTRY=${process.env.NPM_REGISTRY || 'https://packagefeedproxy.microsoft.io/npm/'}`,
				'-t',
				image,
				directory,
			],
			false,
		)
		run(
			'az',
			[
				'acr',
				'login',
				'-n',
				target.registry,
				'--subscription',
				target.subscriptionId,
				'--only-show-errors',
			],
			false,
		)
		run('docker', ['push', image], false)
		const result = az<{ digest: string }>([
			'acr',
			'repository',
			'show',
			'-n',
			target.registry,
			'--image',
			`mico:${sha}`,
		])
		console.log(`Published ${image} (${result.digest})`)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
}

function deploy(): void {
	const sha = revision()
	const group = ['-g', target.resourceGroup]
	const environment = az<{ id: string; properties: { defaultDomain: string } }>([
		'containerapp',
		'env',
		'show',
		...group,
		'-n',
		target.environment,
	])
	const identity = az<{ id: string; clientId: string }>([
		'identity',
		'show',
		...group,
		'-n',
		target.identity,
	])
	if (target.ai && target.ai.clientId.toLowerCase() !== identity.clientId.toLowerCase()) {
		throw new Error('AZURE_CLIENT_ID must match the attached MICO_AZ_IDENTITY')
	}
	const registry = az<{ loginServer: string }>(['acr', 'show', ...group, '-n', target.registry])
	const image = az<{ digest: string }>([
		'acr',
		'repository',
		'show',
		'-n',
		target.registry,
		'--image',
		`mico:${sha}`,
	])
	const origin = azureOrigin(target, environment.properties.defaultDomain)
	const template = containerApp(target, {
		environmentId: environment.id,
		identityId: identity.id,
		registryServer: registry.loginServer,
		digest: image.digest,
		origin,
	})
	const directory = mkdtempSync(join(tmpdir(), 'mico-azure-deploy-'))
	try {
		const path = join(directory, 'app.json')
		writeFileSync(path, JSON.stringify(template), { mode: 0o600 })
		const exists = resources().some(
			(resource) => resource.type === 'Microsoft.App/containerApps' && resource.name === target.app,
		)
		az(['containerapp', exists ? 'update' : 'create', ...group, '-n', target.app, '--yaml', path])
		console.log(`Deployed ${sha} to ${origin}`)
		console.log(`Verify ${origin}/api/live and the anonymous API denial before signing in.`)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
}

try {
	if (command === 'plan') {
		console.log(
			JSON.stringify({ ...target, mossEnabled: false, ephemeral: true, replicas: 1 }, null, 2),
		)
	} else {
		preflight()
		if (command === 'provision') provision()
		if (command === 'build') build()
		if (command === 'deploy') deploy()
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : 'Azure deployment failed')
	process.exitCode = 1
}
