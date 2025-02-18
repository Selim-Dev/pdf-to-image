# PDF to Images Converter

A Node.js script that converts PDF files to high-quality PNG images. Each page of the PDF is saved as a separate numbered image.

## Features

- Converts PDF files to PNG images (configurable format)
- Maintains high quality with 2x scaling (configurable)
- Organizes output images in separate folders by PDF name
- Supports large PDF files
- Handles multiple PDFs
- Error handling and progress logging

## Prerequisites

Before running this script, make sure you have:

- Node.js (version 16 or higher)
- npm (Node Package Manager)

### System Dependencies

On Ubuntu/Debian systems, install the required build dependencies:

```bash
sudo apt-get update
sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

On macOS using Homebrew:

```bash
brew install cairo pango jpeg giflib
```

On Windows:
- Install Windows Build Tools:
```bash
npm install --global --production windows-build-tools
```

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/pdf-to-images.git
cd pdf-to-images
```

2. Install dependencies:
```bash
npm install
```

## Usage

1. Place your PDF files in the `pdfs` directory (it will be created automatically)

2. Run the script:
```bash
node pdf-converter.mjs
```

The script will:
- Create necessary directories if they don't exist
- Process all PDFs in the `pdfs` directory
- Save images in the `images` directory, organized in subfolders by PDF name
- Show progress for each page being converted

### Example Directory Structure

```
pdf-to-images/
├── pdfs/
│   ├── document1.pdf
│   └── document2.pdf
├── images/
│   ├── document1/
│   │   ├── 1.png
│   │   ├── 2.png
│   │   └── 3.png
│   └── document2/
│       ├── 1.png
│       └── 2.png
├── pdf-converter.mjs
├── package.json
└── README.md
```

## Configuration

You can modify the following settings in the `config` object at the top of `pdf-converter.mjs`:

```javascript
const config = {
    inputDir: path.join(__dirname, 'pdfs'),    // Input directory for PDFs
    outputDir: path.join(__dirname, 'images'),  // Output directory for images
    imageFormat: 'png',                         // Output image format
    scale: 2.0                                  // Image quality scale (1.0 = 72dpi)
};
```

## Troubleshooting

### Common Issues

1. `Error: Canvas module not found`
   - Make sure you have all system dependencies installed
   - Try rebuilding the canvas module:
     ```bash
     npm rebuild canvas --build-from-source
     ```

2. `Error: PDF file not found`
   - Ensure your PDF files are in the `pdfs` directory
   - Check file permissions

3. `Error: Module version mismatch`
   - Clean the installation and rebuild:
     ```bash
     rm -rf node_modules package-lock.json
     npm install
     ```

### Debug Mode

To run with debug logging:
```bash
DEBUG=pdf-to-images* node pdf-converter.mjs
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- PDF.js for PDF processing
- node-canvas for image generation