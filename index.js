import express from 'express';
import multer from 'multer';
import cors from 'cors';
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import { createCanvas } from 'canvas';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// App configuration
const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'pdfs'));
  },
  filename: function (req, file, cb) {
    // Use the directory ID if provided, otherwise use timestamp
    const directoryId = req.body.directoryId || Date.now();
    cb(null, `${directoryId}.pdf`);
  }
});

const upload = multer({ storage });

// Track conversion jobs
const conversionJobs = new Map();
let jobCounter = 0;

// Enhanced configuration with compression options
const config = {
    inputDir: path.join(__dirname, 'pdfs'),
    outputDir: path.join(__dirname, 'images'),
    imageFormat: 'jpeg',
    scale: 1.5,
    compressionOptions: {
        jpeg: {
            quality: 75, // Medium quality
            progressive: true,
            optimizeScans: true,
            chromaSubsampling: '4:2:0',
            trellisQuantisation: true,
            overshootDeringing: true,
            optimizeCoding: true,
        },
        png: {
            compressionLevel: 7,
            adaptiveFiltering: true,
            palette: true,
            quality: 75,
        },
        resize: {
            enabled: true,
            maxWidth: 1200,
            maxHeight: 1600,
            fit: 'inside',
        },
        sharpening: {
            enabled: true,
            sigma: 0.5,
            strength: 0.3,
        }
    }
};

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = path.resolve('./node_modules/pdfjs-dist/legacy/build/pdf.worker.js');

// Ensure directories exist
async function ensureDirectoriesExist() {
    try {
        await fs.mkdir(config.inputDir, { recursive: true });
        await fs.mkdir(config.outputDir, { recursive: true });
    } catch (error) {
        console.error('Error creating directories:', error);
        throw error;
    }
}

// Clean up directories
async function cleanupDirectories() {
    try {
        // Clean PDFs folder
        const pdfFiles = await fs.readdir(config.inputDir);
        for (const file of pdfFiles) {
            await fs.unlink(path.join(config.inputDir, file));
        }
        console.log('Cleaned PDF input directory');
        
        // We don't clean the entire images folder, as it might contain 
        // subdirectories for different directory IDs that we want to keep
    } catch (error) {
        console.error('Error cleaning directories:', error);
        // Don't throw to avoid stopping the server - just log it
    }
}

// Clean specific image directory for a directory ID
async function cleanDirectoryImages(directoryId) {
    const dirPath = path.join(config.outputDir, directoryId.toString());
    
    try {
        // Check if directory exists first
        try {
            await fs.access(dirPath);
        } catch (error) {
            // Directory doesn't exist, nothing to clean
            return;
        }
        
        // Read all files in directory
        const files = await fs.readdir(dirPath);
        
        // Delete each file
        for (const file of files) {
            await fs.unlink(path.join(dirPath, file));
        }
        
        console.log(`Cleaned image directory for ID ${directoryId}`);
    } catch (error) {
        console.error(`Error cleaning image directory for ID ${directoryId}:`, error);
        throw error;
    }
}

// Optimize image function
async function optimizeImage(imageBuffer, pageNum, totalPages, format) {
    try {
        // Start with sharp instance
        let sharpInstance = sharp(imageBuffer);
        const opts = config.compressionOptions;
        
        // Apply resizing if enabled
        if (opts.resize.enabled) {
            sharpInstance = sharpInstance.resize({
                width: opts.resize.maxWidth,
                height: opts.resize.maxHeight,
                fit: opts.resize.fit,
                withoutEnlargement: true
            });
        }
        
        // Apply sharpening if enabled
        if (opts.sharpening.enabled) {
            sharpInstance = sharpInstance.sharpen({
                sigma: opts.sharpening.sigma,
                strength: opts.sharpening.strength
            });
        }
        
        // Apply format-specific optimizations
        if (format === 'jpeg') {
            sharpInstance = sharpInstance.jpeg({
                quality: opts.jpeg.quality,
                progressive: opts.jpeg.progressive,
                chromaSubsampling: opts.jpeg.chromaSubsampling,
                trellisQuantisation: opts.jpeg.trellisQuantisation,
                overshootDeringing: opts.jpeg.overshootDeringing,
                optimizeCoding: opts.jpeg.optimizeCoding
            });
        } else if (format === 'png') {
            sharpInstance = sharpInstance.png({
                compressionLevel: opts.png.compressionLevel,
                adaptiveFiltering: opts.png.adaptiveFiltering,
                palette: opts.png.palette,
                quality: opts.png.quality
            });
        } else if (format === 'webp') {
            sharpInstance = sharpInstance.webp({
                quality: opts.jpeg.quality,
                lossless: false,
                nearLossless: false,
                smartSubsample: true,
                effort: 5
            });
        }
        
        // Process the image
        const optimizedImageBuffer = await sharpInstance.toBuffer();
        
        // Calculate compression ratio for logging
        const compressionRatio = (imageBuffer.length / optimizedImageBuffer.length).toFixed(2);
        console.log(`Page ${pageNum}/${totalPages} - Compression ratio: ${compressionRatio}x (${(imageBuffer.length / 1024).toFixed(2)}KB → ${(optimizedImageBuffer.length / 1024).toFixed(2)}KB)`);
        
        return optimizedImageBuffer;
    } catch (error) {
        console.error(`Error optimizing image for page ${pageNum}:`, error);
        return imageBuffer; // Return original if optimization fails
    }
}

// Convert PDF to images
async function convertPDFToImages(pdfPath, directoryId, jobId) {
    try {
        // Update job status
        const job = conversionJobs.get(jobId);
        job.status = 'processing';
        
        // First, clean the output directory for this directory ID
        await cleanDirectoryImages(directoryId);
        
        // Check if file exists
        try {
            await fs.access(pdfPath);
        } catch (error) {
            job.status = 'failed';
            job.error = `PDF file not found at path: ${pdfPath}`;
            throw new Error(`PDF file not found at path: ${pdfPath}`);
        }

        // Load the PDF document
        const data = new Uint8Array(await fs.readFile(pdfPath));
        const loadingTask = pdfjsLib.getDocument({ data });
        const pdfDocument = await loadingTask.promise;
        const totalPages = pdfDocument.numPages;
        
        // Update job with total pages
        job.totalPages = totalPages;
        job.processedPages = 0;
        
        console.log(`Processing PDF: ${path.basename(pdfPath)}`);
        console.log(`Total pages: ${totalPages}`);

        // Create a subdirectory for this PDF's images
        const pdfOutputDir = path.join(config.outputDir, directoryId.toString());
        await fs.mkdir(pdfOutputDir, { recursive: true });

        // Track file sizes for reporting
        let totalOriginalSize = 0;
        let totalCompressedSize = 0;

        // Convert each page
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            // Update progress
            job.currentPage = pageNum;
            
            const page = await pdfDocument.getPage(pageNum);
            const viewport = page.getViewport({ scale: config.scale });

            // Prepare canvas
            const canvas = createCanvas(viewport.width, viewport.height);
            const context = canvas.getContext('2d');
            context.fillStyle = 'white';
            context.fillRect(0, 0, viewport.width, viewport.height);

            // Render PDF page
            const renderContext = {
                canvasContext: context,
                viewport: viewport
            };

            try {
                await page.render(renderContext).promise;

                const format = config.imageFormat.toLowerCase();
                const rawImageData = canvas.toBuffer(`image/${format === 'webp' ? 'png' : format}`);
                totalOriginalSize += rawImageData.length;

                // Optimize the image
                const optimizedImageData = await optimizeImage(rawImageData, pageNum, totalPages, format);
                totalCompressedSize += optimizedImageData.length;

                // Save the optimized image
                const imagePath = path.join(pdfOutputDir, `${pageNum}.${format}`);
                await fs.writeFile(imagePath, optimizedImageData);

                // Update job progress
                job.processedPages++;
                job.progress = Math.floor((job.processedPages / totalPages) * 100);
                
                // Memory management: explicitly release page when done
                page.cleanup();
            } catch (renderError) {
                console.error(`Error rendering page ${pageNum}:`, renderError);
                job.errors = job.errors || [];
                job.errors.push(`Error on page ${pageNum}: ${renderError.message}`);
                continue; // Skip to next page if there's an error
            }
        }

        // Report overall compression results
        const overallRatio = (totalOriginalSize / totalCompressedSize).toFixed(2);
        console.log(`\nConversion complete for directory ${directoryId}`);
        console.log(`Overall compression ratio: ${overallRatio}x`);
        
        // Get the absolute path to the output directory
        const absoluteOutputPath = path.resolve(pdfOutputDir);
        
        // Update job to completed
        job.status = 'completed';
        job.outputPath = absoluteOutputPath;
        job.endTime = new Date();
        job.progress = 100;
        job.compressionRatio = overallRatio;
        
        console.log(`Images saved to: ${absoluteOutputPath}`);
        console.log(`Conversion job completed:`, job);
        return absoluteOutputPath;
    } catch (error) {
        // Update job status on error
        const job = conversionJobs.get(jobId);
        if (job) {
            job.status = 'failed';
            job.error = error.message;
            job.endTime = new Date();
        }
        
        console.error('Error converting PDF to images:', error);
        throw error;
    }
}

// API Endpoints

// Upload PDF
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
    try {
        await ensureDirectoriesExist();
        
        if (!req.file) {
            return res.status(400).json({ error: 'No PDF file uploaded' });
        }
        
        const directoryId = req.body.directoryId || Date.now();
        const pdfPath = req.file.path;
        
        console.log(`Received PDF upload for directory ID: ${directoryId}`);
        console.log(`PDF saved to: ${pdfPath}`);
        
        // Create a new job
        const jobId = ++jobCounter;
        const job = {
            id: jobId,
            directoryId,
            pdfPath,
            status: 'pending',
            progress: 0,
            startTime: new Date(),
            processedPages: 0,
            totalPages: 0
        };
        
        conversionJobs.set(jobId, job);
        console.log(`Created new job ${jobId} for directory ${directoryId}`);
        
        // Start conversion in background
        setImmediate(() => {
            convertPDFToImages(pdfPath, directoryId, jobId)
                .catch(error => console.error(`Job ${jobId} failed:`, error));
        });
        
        return res.status(200).json({ 
            message: 'PDF uploaded successfully, conversion started',
            jobId,
            directoryId
        });
    } catch (error) {
        console.error('Error handling upload:', error);
        return res.status(500).json({ error: error.message });
    }
});

// Get job status - with more detailed debugging
app.get('/api/jobs/:jobId', (req, res) => {
    const jobId = parseInt(req.params.jobId);
    console.log(`Received request for job ${jobId} status`);
    
    const job = conversionJobs.get(jobId);
    
    if (!job) {
        console.log(`Job ${jobId} not found`);
        return res.status(404).json({ error: 'Job not found' });
    }
    
    // Create a clean copy of the job to ensure no circular references
    const jobResponse = {
        id: job.id,
        directoryId: job.directoryId,
        status: job.status,
        progress: job.progress,
        processedPages: job.processedPages,
        totalPages: job.totalPages,
        outputPath: job.outputPath,
        startTime: job.startTime,
        endTime: job.endTime,
        error: job.error,
        errors: job.errors,
        compressionRatio: job.compressionRatio
    };
    
    console.log(`Returning job ${jobId} status:`, jobResponse);
    return res.status(200).json(jobResponse);
});

// Add new endpoint to clean everything (for maintenance)
app.post('/api/maintenance/cleanup', async (req, res) => {
    try {
        await cleanupDirectories();
        return res.status(200).json({ 
            message: 'All temporary directories cleaned successfully' 
        });
    } catch (error) {
        console.error('Cleanup failed:', error);
        return res.status(500).json({ error: error.message });
    }
});

// Add health check endpoint
app.get('/api/health', (req, res) => {
    return res.status(200).json({
        status: 'ok',
        version: '1.0.0',
        activeJobs: conversionJobs.size,
        uptime: process.uptime()
    });
});

// Start the server
app.listen(port, async () => {
    try {
        await ensureDirectoriesExist();
        // Optional: Clean directories on startup
        await cleanupDirectories();
        console.log(`PDF converter service running on port ${port}`);
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
});