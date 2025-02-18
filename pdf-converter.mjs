import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import { createCanvas } from 'canvas';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const config = {
    inputDir: path.join(__dirname, 'pdfs'),    // Directory for PDF files
    outputDir: path.join(__dirname, 'images'),  // Directory for output images
    imageFormat: 'png',                         // Output image format
    scale: 2.0                                  // Image quality scale (1.0 = 72dpi)
};

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = path.resolve('./node_modules/pdfjs-dist/legacy/build/pdf.worker.js');

async function ensureDirectoriesExist() {
    try {
        await fs.mkdir(config.outputDir, { recursive: true });
    } catch (error) {
        console.error('Error creating output directory:', error);
        throw error;
    }
}

async function convertPDFToImages(pdfPath) {
    try {
        // Check if file exists
        try {
            await fs.access(pdfPath);
        } catch (error) {
            throw new Error(`PDF file not found at path: ${pdfPath}`);
        }

        // Load the PDF document
        const data = new Uint8Array(await fs.readFile(pdfPath));
        const loadingTask = pdfjsLib.getDocument({ data });
        const pdfDocument = await loadingTask.promise;
        const totalPages = pdfDocument.numPages;
        
        console.log(`Processing PDF: ${path.basename(pdfPath)}`);
        console.log(`Total pages: ${totalPages}`);

        // Create a subdirectory for this PDF's images
        const pdfName = path.basename(pdfPath, '.pdf');
        const pdfOutputDir = path.join(config.outputDir, pdfName);
        await fs.mkdir(pdfOutputDir, { recursive: true });

        // Convert each page
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            const page = await pdfDocument.getPage(pageNum);
            const viewport = page.getViewport({ scale: config.scale });

            // Prepare canvas
            const canvas = createCanvas(viewport.width, viewport.height);
            const context = canvas.getContext('2d');

            // Render PDF page
            const renderContext = {
                canvasContext: context,
                viewport: viewport
            };

            try {
                await page.render(renderContext).promise;

                // Save the image
                const imagePath = path.join(pdfOutputDir, `${pageNum}.${config.imageFormat}`);
                const imageData = canvas.toBuffer(`image/${config.imageFormat}`);
                await fs.writeFile(imagePath, imageData);

                console.log(`Page ${pageNum}/${totalPages} converted`);
            } catch (renderError) {
                console.error(`Error rendering page ${pageNum}:`, renderError);
                continue; // Skip to next page if there's an error
            }
        }

        console.log(`Conversion complete for ${pdfName}`);
        return pdfOutputDir;
    } catch (error) {
        console.error('Error converting PDF to images:', error);
        throw error;
    }
}

async function getAllPDFFiles() {
    try {
        const files = await fs.readdir(config.inputDir);
        return files
            .filter(file => file.toLowerCase().endsWith('.pdf'))
            .map(file => path.join(config.inputDir, file));
    } catch (error) {
        console.error('Error reading directory:', error);
        throw error;
    }
}

async function main() {
    try {
        await ensureDirectoriesExist();

        // Get all PDF files from the input directory
        const pdfFiles = await getAllPDFFiles();
        
        if (pdfFiles.length === 0) {
            console.log('No PDF files found in the input directory');
            return;
        }

        console.log(`Found ${pdfFiles.length} PDF files to process`);

        // Process each PDF file
        for (const pdfPath of pdfFiles) {
            try {
                console.log(`\nStarting conversion of ${path.basename(pdfPath)}`);
                const outputDir = await convertPDFToImages(pdfPath);
                console.log(`Images saved in: ${outputDir}`);
            } catch (error) {
                console.error(`Error processing ${path.basename(pdfPath)}:`, error.message);
                // Continue with next PDF even if one fails
                continue;
            }
        }
        
        console.log('\nAll PDF conversions completed');
        
    } catch (error) {
        console.error('Main process error:', error.message);
        process.exit(1);
    }
}

// Run the script
main();