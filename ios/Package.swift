// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "CycleProtocol", products: [.library(name: "CycleProtocol", targets: ["CycleProtocol"])], targets: [
    .target(name: "CycleProtocol", path: "MyCycleWorld/Core"),
    .testTarget(name: "CycleProtocolTests", dependencies: ["CycleProtocol"], path: "Tests")
])
