import { Storage } from "@google-cloud/storage";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";

// Initialize Google Cloud Storage with environment variable fallback
let storage: Storage;

try {
  // Check if we're in development (local) or production (Vercel)
  const isDevelopment = process.env.NODE_ENV === 'development';
  const serviceAccountPath = path.join(process.cwd(), "gcp-service-key.json");
  
  console.log("🔍 Environment:", process.env.NODE_ENV);
  console.log("🔍 Service account path:", serviceAccountPath);
  console.log("📁 Service account file exists:", fs.existsSync(serviceAccountPath));
  console.log("🔑 Environment variables available:", {
    projectId: !!process.env.GOOGLE_CLOUD_PROJECT_ID,
    clientEmail: !!process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
    privateKey: !!process.env.GOOGLE_CLOUD_PRIVATE_KEY,
    credentialsBase64: !!process.env.GOOGLE_CLOUD_CREDENTIALS_BASE64
  });

  if (isDevelopment && fs.existsSync(serviceAccountPath)) {
    // Development: Use service account file
    console.log("✅ Using service account file for authentication (Development)");
    storage = new Storage({
      keyFilename: serviceAccountPath,
      projectId: "revault-system",
    });
  } else if (process.env.GOOGLE_CLOUD_CREDENTIALS_BASE64) {
    // Production: Use base64 encoded credentials
    console.log("✅ Using base64 encoded credentials (Production)");
    const credentialsJSON = Buffer.from(
      process.env.GOOGLE_CLOUD_CREDENTIALS_BASE64,
      'base64'
    ).toString('utf-8');
    const credentials = JSON.parse(credentialsJSON);
    
    storage = new Storage({
      projectId: credentials.project_id || "revault-system",
      credentials,
    });
  } else if (process.env.GOOGLE_CLOUD_PROJECT_ID && process.env.GOOGLE_CLOUD_CLIENT_EMAIL && process.env.GOOGLE_CLOUD_PRIVATE_KEY) {
    // Production: Use individual environment variables
    console.log("✅ Using individual environment variables (Production)");
    storage = new Storage({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      credentials: {
        client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_CLOUD_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
    });
  } else {
    // Fallback: Use Application Default Credentials (if running on GCP)
    console.log("⚠️ Using Application Default Credentials");
    storage = new Storage({
      projectId: "revault-system",
    });
  }
} catch (error) {
  console.error("❌ Failed to initialize Google Cloud Storage:", error);
  throw error;
}

const bucketName = "revault-files";

export async function testConnection(): Promise<boolean> {
  try {
    console.log("🔍 Testing Google Cloud Storage connection...");
    
    const [buckets] = await storage.getBuckets();
    console.log("✅ Successfully connected to Google Cloud Storage");
    console.log("📦 Available buckets:", buckets.map(b => b.name));
    
    const bucket = storage.bucket(bucketName);
    const [exists] = await bucket.exists();
    console.log(`📦 Bucket '${bucketName}' exists:`, exists);
    
    if (!exists) {
      console.log("❌ Target bucket does not exist!");
      return false;
    }
    
    const [metadata] = await bucket.getMetadata();
    console.log("📋 Bucket metadata:", {
      name: metadata.name,
      location: metadata.location,
      storageClass: metadata.storageClass,
      timeCreated: metadata.timeCreated
    });
    
    return true;
  } catch (error) {
    console.error("❌ Connection test failed:", error);
    return false;
  }
}

// Original upload function for PDF papers (UNCHANGED)
export async function uploadFile(buffer: Buffer, originalFilename: string): Promise<string> {
  try {
    console.log("📤 Starting PDF file upload process...");
    console.log("📄 Original filename:", originalFilename);
    console.log("📊 Buffer size:", buffer.length, "bytes");
    
    // Test connection first
    const connectionOk = await testConnection();
    if (!connectionOk) {
      throw new Error("Google Cloud Storage connection failed");
    }
    
    // Generate unique filename to avoid conflicts
    const fileExtension = path.extname(originalFilename);
    const baseName = path.basename(originalFilename, fileExtension);
    const uniqueFilename = `${baseName}-${uuidv4()}${fileExtension}`;
    
    // Add timestamp folder structure for organization
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const filepath = `papers/${timestamp}/${uniqueFilename}`;
    
    console.log("📁 Upload path:", filepath);

    const bucket = storage.bucket(bucketName);
    const file = bucket.file(filepath);

    console.log("⬆️ Uploading PDF file to Google Cloud Storage...");
    
    // Upload the file WITHOUT setting public: true (this causes the ACL error)
    await file.save(buffer, {
      metadata: {
        contentType: "application/pdf",
        cacheControl: "public, max-age=31536000",
        // Add custom metadata for debugging
        uploadedAt: new Date().toISOString(),
        originalName: originalFilename,
        fileType: "research_paper"
      },
      // Remove public: true - this causes the ACL error with uniform bucket access
      resumable: false,
      validation: 'crc32c',
    });

    console.log("✅ PDF file uploaded successfully!");
    
    // Verify the file exists
    const [exists] = await file.exists();
    console.log("🔍 File exists after upload:", exists);
    
    if (!exists) {
      throw new Error("File was not found after upload");
    }
    
    // Get file metadata to confirm upload
    const [metadata] = await file.getMetadata();
    console.log("📋 Uploaded file metadata:", {
      name: metadata.name,
      size: metadata.size,
      contentType: metadata.contentType,
      timeCreated: metadata.timeCreated,
      md5Hash: metadata.md5Hash
    });

    // Generate public URL (this will work even with uniform bucket access if bucket is public)
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${filepath}`;
    console.log("🌐 Public URL:", publicUrl);
    
    return publicUrl;
    
  } catch (error) {
    console.error("❌ Error uploading PDF file to GCP:");
    console.error("Error type:", error.constructor.name);
    console.error("Error message:", error.message);
    
    if (error.code) {
      console.error("Error code:", error.code);
    }
    
    if (error.errors) {
      console.error("Detailed errors:", error.errors);
    }
    
    throw new Error(`Failed to upload PDF file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// NEW: Upload function specifically for profile pictures
export async function uploadProfilePicture(buffer: Buffer, originalFilename: string, userId: string): Promise<string> {
  try {
    console.log("📤 Starting profile picture upload process...");
    console.log("📄 Original filename:", originalFilename);
    console.log("👤 User ID:", userId);
    console.log("📊 Buffer size:", buffer.length, "bytes");
    
    // Test connection first
    const connectionOk = await testConnection();
    if (!connectionOk) {
      throw new Error("Google Cloud Storage connection failed");
    }
    
    // Generate unique filename to avoid conflicts
    const fileExtension = path.extname(originalFilename);
    const baseName = path.basename(originalFilename, fileExtension);
    const uniqueFilename = `${baseName}-${uuidv4()}${fileExtension}`;
    
    // Create profile folder structure: profiles/userId/filename
    const filepath = `profiles/${userId}/${uniqueFilename}`;
    
    console.log("📁 Upload path:", filepath);

    const bucket = storage.bucket(bucketName);
    const file = bucket.file(filepath);

    console.log("⬆️ Uploading profile picture to Google Cloud Storage...");
    
    // Determine content type based on file extension
    const getContentType = (filename: string): string => {
      const ext = path.extname(filename).toLowerCase();
      switch (ext) {
        case '.jpg':
        case '.jpeg':
          return 'image/jpeg';
        case '.png':
          return 'image/png';
        case '.gif':
          return 'image/gif';
        case '.webp':
          return 'image/webp';
        default:
          return 'image/jpeg';
      }
    };
    
    // Upload the file
    await file.save(buffer, {
      metadata: {
        contentType: getContentType(originalFilename),
        cacheControl: "public, max-age=31536000",
        // Add custom metadata
        uploadedAt: new Date().toISOString(),
        originalName: originalFilename,
        userId: userId,
        fileType: "profile_picture"
      },
      resumable: false,
      validation: 'crc32c',
    });

    console.log("✅ Profile picture uploaded successfully!");
    
    // Verify the file exists
    const [exists] = await file.exists();
    console.log("🔍 Profile picture exists after upload:", exists);
    
    if (!exists) {
      throw new Error("Profile picture was not found after upload");
    }
    
    // Get file metadata to confirm upload
    const [metadata] = await file.getMetadata();
    console.log("📋 Uploaded profile picture metadata:", {
      name: metadata.name,
      size: metadata.size,
      contentType: metadata.contentType,
      timeCreated: metadata.timeCreated,
      md5Hash: metadata.md5Hash
    });
    
    // Generate the public URL
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${filepath}`;
    console.log("🌐 Profile picture public URL:", publicUrl);
    
    return publicUrl;
    
  } catch (error) {
    console.error("❌ Error uploading profile picture to GCP:");
    console.error("Error type:", error.constructor.name);
    console.error("Error message:", error.message);
    
    if (error.code) {
      console.error("Error code:", error.code);
    }
    
    if (error.errors) {
      console.error("Detailed errors:", error.errors);
    }
    
    throw new Error(`Failed to upload profile picture: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Helper function to delete old profile pictures
export async function deleteProfilePicture(userId: string, filename: string): Promise<boolean> {
  try {
    console.log("🗑️ Deleting old profile picture...");
    console.log("👤 User ID:", userId);
    console.log("📄 Filename:", filename);
    
    const filepath = `profiles/${userId}/${filename}`;
    
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(filepath);
    
    await file.delete();
    
    console.log("✅ Old profile picture deleted successfully!");
    return true;
    
  } catch (error) {
    console.error("❌ Failed to delete old profile picture:", error);
    return false;
  }
}

// Function to make bucket publicly accessible (for uniform bucket access)
export async function makeBucketPublic(): Promise<void> {
  try {
    const bucket = storage.bucket(bucketName);
    
    // For uniform bucket-level access, we need to set IAM policy instead of ACLs
    await bucket.iam.setPolicy({
      bindings: [
        {
          role: 'roles/storage.objectViewer',
          members: ['allUsers'],
        },
      ],
    });
    
    console.log(`✅ Bucket ${bucketName} is now publicly readable`);
  } catch (error) {
    console.error("❌ Error making bucket public:", error);
    throw error;
  }
}

// Function to create bucket if it doesn't exist
export async function createBucketIfNotExists(): Promise<void> {
  try {
    const bucket = storage.bucket(bucketName);
    const [exists] = await bucket.exists();
    
    if (!exists) {
      console.log(`📦 Creating bucket: ${bucketName}`);
      
      const [newBucket] = await storage.createBucket(bucketName, {
        location: 'ASIA-SOUTHEAST1', // Match your existing bucket location
        storageClass: 'STANDARD',
        uniformBucketLevelAccess: {
          enabled: true // Enable uniform bucket access for new buckets
        }
      });
      
      console.log(`✅ Bucket created: ${bucketName}`);
      
      // Make bucket publicly readable using IAM policy
      await makeBucketPublic();
      
    } else {
      console.log(`✅ Bucket already exists: ${bucketName}`);
    }
  } catch (error) {
    console.error("❌ Error creating bucket:", error);
    throw error;
  }
}

// Debug function to list all files in bucket
export async function listBucketFiles(): Promise<void> {
  try {
    const bucket = storage.bucket(bucketName);
    const [files] = await bucket.getFiles();
    
    console.log(`📁 Files in bucket '${bucketName}':`);
    if (files.length === 0) {
      console.log("  (No files found)");
    } else {
      files.forEach(file => {
        console.log(`  - ${file.name}`);
      });
    }
  } catch (error) {
    console.error("❌ Error listing bucket files:", error);
  }
}

// Debug function to list files by folder
export async function listFilesByFolder(folderPrefix: string): Promise<void> {
  try {
    const bucket = storage.bucket(bucketName);
    const [files] = await bucket.getFiles({ prefix: folderPrefix });
    
    console.log(`📁 Files in folder '${folderPrefix}':`);
    if (files.length === 0) {
      console.log("  (No files found)");
    } else {
      files.forEach(file => {
        console.log(`  - ${file.name}`);
      });
    }
  } catch (error) {
    console.error(`❌ Error listing files in folder '${folderPrefix}':`, error);
  }
}