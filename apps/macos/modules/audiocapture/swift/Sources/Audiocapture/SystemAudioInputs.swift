import CoreAudio
import Foundation

enum SystemAudioInputs {
    static func defaultDeviceID() -> String? {
        let system = AudioObjectID(kAudioObjectSystemObject)
        guard let device = integerProperty(system, selector: kAudioHardwarePropertyDefaultInputDevice),
              device != kAudioObjectUnknown else {
            return nil
        }
        return stringProperty(device, selector: kAudioDevicePropertyDeviceUID)
    }

    static func devices() -> [InputDevice] {
        let defaultID = defaultDeviceID()
        let system = AudioObjectID(kAudioObjectSystemObject)
        var property = address(kAudioHardwarePropertyDevices)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(system, &property, 0, nil, &size) == noErr, size > 0 else {
            return []
        }
        var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(system, &property, 0, nil, &size, &ids) == noErr else {
            return []
        }
        return ids.compactMap { device in
            var streams = address(kAudioDevicePropertyStreams, scope: kAudioObjectPropertyScopeInput)
            var streamSize: UInt32 = 0
            guard integerProperty(device, selector: kAudioDevicePropertyDeviceIsAlive) == 1,
                  AudioObjectGetPropertyDataSize(device, &streams, 0, nil, &streamSize) == noErr,
                  streamSize > 0,
                  let uid = stringProperty(device, selector: kAudioDevicePropertyDeviceUID),
                  let name = stringProperty(device, selector: kAudioObjectPropertyName) else {
                return nil
            }
            return InputDevice(id: uid, name: name, isDefault: uid == defaultID)
        }.sorted { lhs, rhs in
            if lhs.isDefault != rhs.isDefault {
                return lhs.isDefault
            }
            return lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending
        }
    }

    static func resolveEffectiveDeviceID(preferred: String) -> String? {
        let live = devices()
        let trimmed = preferred.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty, live.contains(where: { $0.id == trimmed }) {
            return trimmed
        }
        if let def = defaultDeviceID(), live.contains(where: { $0.id == def }) {
            return def
        }
        return live.first?.id
    }

    private static func address(
        _ selector: AudioObjectPropertySelector,
        scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal
    ) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain
        )
    }

    private static func integerProperty(_ object: AudioObjectID, selector: AudioObjectPropertySelector) -> UInt32? {
        var property = address(selector)
        var value: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(object, &property, 0, nil, &size, &value) == noErr else {
            return nil
        }
        return value
    }

    private static func stringProperty(_ object: AudioObjectID, selector: AudioObjectPropertySelector) -> String? {
        var property = address(selector)
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(object, &property, 0, nil, &size, &value) == noErr else {
            return nil
        }
        return value?.takeRetainedValue() as String?
    }
}
