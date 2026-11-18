import type { WhiteboardMember } from '../../../shared/whiteboards.ts'

export interface MeetingParticipant {
	id?: string
	name: string
	initial: string
	color: 'grape' | 'sky' | 'peach' | 'mint' | 'lemon'
	presenter?: boolean
	self?: boolean
}

export interface MeetingPresence {
	members: readonly WhiteboardMember[]
	presenterId: string | null
	selfId: string | null
}

export interface MeetingViewModel {
	title: string
	detail: string
	elapsed: string
	participants: readonly MeetingParticipant[]
	controlsEnabled: boolean
}

export function meetingPreview(presence?: MeetingPresence): MeetingViewModel {
	const colors = ['grape', 'sky', 'peach', 'mint', 'lemon'] as const
	return {
		title: presence ? 'Demo participants' : 'Meeting preview',
		detail: presence
			? `${presence.members.length} online · no meeting connected`
			: 'Demo · no meeting connected',
		elapsed: '0:00',
		participants: presence
			? presence.members.map((member, index) => ({
					id: member.id,
					name: member.username,
					initial: [...member.username.trim()][0]?.toLocaleUpperCase() ?? '',
					color: colors[index % colors.length],
					presenter: member.id === presence.presenterId,
					self: member.id === presence.selfId,
				}))
			: [
					{ name: 'Participant 1', initial: 'A', color: 'grape' },
					{ name: 'Participant 2', initial: 'B', color: 'sky' },
					{ name: 'Participant 3', initial: 'C', color: 'peach' },
					{ name: 'Participant 4', initial: 'D', color: 'mint' },
					{ name: 'You', initial: 'Y', color: 'lemon' },
				],
		controlsEnabled: false,
	}
}
