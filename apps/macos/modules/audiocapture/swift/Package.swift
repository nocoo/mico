// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Audiocapture",
    platforms: [.macOS(.v15)],
    products: [.library(name: "Audiocapture", type: .dynamic, targets: ["Audiocapture"])],
    dependencies: [],
    targets: [
        .target(
            name: "Audiocapture",
            linkerSettings: [
                .linkedFramework("ScreenCaptureKit"),
                .linkedFramework("CoreAudio"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("CoreMedia"),
            ]
        ),
    ],
    swiftLanguageModes: [.v5]
)
