import AppKit
let size = 1024
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 3, hasAlpha: false, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSColor(calibratedRed: 0.035, green: 0.09, blue: 0.13, alpha: 1).setFill()
NSBezierPath(rect: NSRect(x: 0, y: 0, width: size, height: size)).fill()
NSColor(calibratedRed: 0.27, green: 0.94, blue: 0.72, alpha: 1).setStroke()
for x in [280, 744] {
 let circle = NSBezierPath(ovalIn: NSRect(x: x - 145, y: 210, width: 290, height: 290)); circle.lineWidth = 30; circle.stroke()
}
let frame = NSBezierPath(); frame.lineWidth = 32; frame.lineJoinStyle = .round; frame.lineCapStyle = .round
frame.move(to: NSPoint(x: 280, y: 355)); frame.line(to: NSPoint(x: 405, y: 585)); frame.line(to: NSPoint(x: 650, y: 585)); frame.line(to: NSPoint(x: 500, y: 355)); frame.close()
frame.move(to: NSPoint(x: 405, y: 585)); frame.line(to: NSPoint(x: 500, y: 355))
frame.move(to: NSPoint(x: 744, y: 355)); frame.line(to: NSPoint(x: 622, y: 660)); frame.line(to: NSPoint(x: 707, y: 660))
frame.move(to: NSPoint(x: 405, y: 585)); frame.line(to: NSPoint(x: 380, y: 650))
frame.move(to: NSPoint(x: 335, y: 650)); frame.line(to: NSPoint(x: 440, y: 650)); frame.stroke()
NSColor.white.setFill()
let bolt = NSBezierPath(); bolt.move(to: NSPoint(x: 554, y: 887)); bolt.line(to: NSPoint(x: 450, y: 739)); bolt.line(to: NSPoint(x: 519, y: 739)); bolt.line(to: NSPoint(x: 478, y: 665)); bolt.line(to: NSPoint(x: 592, y: 799)); bolt.line(to: NSPoint(x: 527, y: 799)); bolt.close(); bolt.fill()
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
