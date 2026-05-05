import AppKit
import Foundation

let arguments = CommandLine.arguments

guard arguments.count == 3 else {
  fputs("Usage: swift generate-iconset.swift <source-png> <output-iconset>\n", stderr)
  exit(1)
}

let sourcePath = arguments[1]
let outputDirectory = URL(fileURLWithPath: arguments[2], isDirectory: true)

guard let sourceImage = NSImage(contentsOfFile: sourcePath), sourceImage.size.width > 0, sourceImage.size.height > 0 else {
  fputs("Could not read source image: \(sourcePath)\n", stderr)
  exit(1)
}

try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)

let iconSizes: [(pixels: Int, filename: String)] = [
  (16, "icon_16x16.png"),
  (32, "icon_16x16@2x.png"),
  (32, "icon_32x32.png"),
  (64, "icon_32x32@2x.png"),
  (128, "icon_128x128.png"),
  (256, "icon_128x128@2x.png"),
  (256, "icon_256x256.png"),
  (512, "icon_256x256@2x.png"),
  (512, "icon_512x512.png"),
  (1024, "icon_512x512@2x.png"),
]

for icon in iconSizes {
  guard
    let bitmap = NSBitmapImageRep(
      bitmapDataPlanes: nil,
      pixelsWide: icon.pixels,
      pixelsHigh: icon.pixels,
      bitsPerSample: 8,
      samplesPerPixel: 4,
      hasAlpha: true,
      isPlanar: false,
      colorSpaceName: .deviceRGB,
      bytesPerRow: 0,
      bitsPerPixel: 0
    )
  else {
    fputs("Could not create bitmap for \(icon.filename)\n", stderr)
    exit(1)
  }

  bitmap.size = NSSize(width: icon.pixels, height: icon.pixels)

  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
  NSColor.clear.setFill()
  NSRect(x: 0, y: 0, width: icon.pixels, height: icon.pixels).fill()

  let sourceAspect = sourceImage.size.width / sourceImage.size.height
  let maxArtworkSize = CGFloat(icon.pixels) * 0.82
  let drawSize: NSSize

  if sourceAspect >= 1 {
    drawSize = NSSize(width: maxArtworkSize, height: maxArtworkSize / sourceAspect)
  } else {
    drawSize = NSSize(width: maxArtworkSize * sourceAspect, height: maxArtworkSize)
  }

  let verticalOpticalOffset = -CGFloat(icon.pixels) * 0.035
  let drawOrigin = NSPoint(
    x: (CGFloat(icon.pixels) - drawSize.width) / 2,
    y: ((CGFloat(icon.pixels) - drawSize.height) / 2) + verticalOpticalOffset
  )

  sourceImage.draw(
    in: NSRect(origin: drawOrigin, size: drawSize),
    from: NSRect(origin: .zero, size: sourceImage.size),
    operation: .sourceOver,
    fraction: 1
  )
  NSGraphicsContext.restoreGraphicsState()

  guard let pngData = bitmap.representation(using: .png, properties: [:]) else {
    fputs("Could not render \(icon.filename)\n", stderr)
    exit(1)
  }

  let destination = outputDirectory.appendingPathComponent(icon.filename)
  try pngData.write(to: destination)
}
