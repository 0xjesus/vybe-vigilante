import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import AWS from 'aws-sdk';
import slugify from 'slugify';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

const prisma = new PrismaClient();

// AWS SDK Configuration
const spacesEndpoint = new AWS.Endpoint(process.env.SPACES_ENDPOINT);
const s3 = new AWS.S3({
  endpoint: spacesEndpoint,
  accessKeyId: process.env.SPACES_KEY,
  secretAccessKey: process.env.SPACES_SECRET,
});

const EXT_MAP = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
};

// Constants for field size limits
const MAX_FIELD_LENGTHS = {
  slug: 255,
  name: 255,
  attachment: 255, // This is the field causing the error
  url: 255
};

class UploadService {
  static async createAttachment(file, params = {}) {
    console.log('🚀 [UploadService] createAttachment started');
    try {
      const paramMetas = params.metas || {};
      const mimeType = file.mimetype;
      const acl = params.acl || 'public-read';

      console.log('🔍 MIME type detected:', mimeType);

      let extension = path.extname(file.originalname).toLowerCase();
      if (!extension) {
        console.log('⚠️ No extension found in original name, checking MIME map...');
        extension = EXT_MAP[mimeType] || '';
      }

      console.log('📌 File extension resolved:', extension);

      // Generate a shorter but still unique filename
      const shortUuid = uuidv4().split('-')[0]; // Use only first part of UUID
      const baseName = path.basename(file.originalname, extension);
      // Limit basename to prevent overly long filenames
      const shortBaseName = baseName.length > 30 ? baseName.substring(0, 30) : baseName;
      const rawFilename = `${shortUuid}-${shortBaseName}${extension}`;
      let filename = slugify(rawFilename, { lower: true });

      console.log('📝 Filename after slugification:', filename);

      const date = new Date();
      const year = date.getFullYear();
      let month = date.getMonth() + 1;
      if (month < 10) month = '0' + month;

      const fileBuffer = file.buffer;

      // Create a path that will be short enough for the database
      const keyPath = `upload/${year}/${month}/${filename}`;

      // Ensure keyPath is within database limits
      const truncatedKeyPath = keyPath.length > MAX_FIELD_LENGTHS.attachment
          ? keyPath.substring(0, MAX_FIELD_LENGTHS.attachment - 10) + extension
          : keyPath;

      console.log('📂 Key path for upload:', truncatedKeyPath);

      const s3Params = {
        Bucket: process.env.SPACES_BUCKET_NAME,
        Key: truncatedKeyPath, // Use the truncated path for S3
        Body: fileBuffer,
        ACL: acl,
        ContentType: mimeType,
      };

      console.log('📤 Uploading to S3 with params:', s3Params);

      const data = await s3.upload(s3Params).promise();

      console.log('✅ Uploaded to DigitalOcean:', data);

      // Ensure name and slug are within database limits
      const truncatedName = file.originalname.length > MAX_FIELD_LENGTHS.name
          ? file.originalname.substring(0, MAX_FIELD_LENGTHS.name - 3) + '...'
          : file.originalname;

      const truncatedSlug = filename.length > MAX_FIELD_LENGTHS.slug
          ? filename.substring(0, MAX_FIELD_LENGTHS.slug - 10) + extension
          : filename;

      // Ensure URL is within database limits
      const truncatedUrl = data.Location.length > MAX_FIELD_LENGTHS.url
          ? data.Location.substring(0, MAX_FIELD_LENGTHS.url - 3) + '...'
          : data.Location;

      const attachment = await prisma.attachment.create({
        data: {
          name: truncatedName,
          slug: truncatedSlug,
          url: truncatedUrl,
          attachment: truncatedKeyPath, // This was the field causing the error
          mime: mimeType,
          size: file.size,
          source: 'digitalocean',
          acl,
          metas: {
            location: data.Location,
            s3: data,
            originalUrl: data.Location, // Store original full URL
            ...paramMetas,
          },
        },
      });

      console.log('✅ Attachment record created in DB:', attachment);

      return attachment;
    } catch (error) {
      console.error('❌ [UploadService] createAttachment error:', error);
      throw error;
    }
  }

  static async downloadAttachment(id) {
    try {
      console.log(`🔍 Downloading attachment with ID: ${id}`);
      const attachment = await prisma.attachment.findUnique({
        where: { id: parseInt(id) },
      });

      if (!attachment) throw new Error('Attachment not found');

      const s3Params = {
        Bucket: process.env.SPACES_BUCKET_NAME,
        Key: attachment.attachment,
      };

      const data = await s3.getObject(s3Params).promise();
      console.log('✅ Attachment downloaded:', data);

      return { attachment, data };
    } catch (error) {
      console.error('❌ [UploadService] downloadAttachment error:', error);
      throw error;
    }
  }

  static async createAttachmentFromUrl(url, params = {}) {
    console.log(`🚀 Creating attachment from URL: ${url}`);
    try {
      // Extract a reasonable filename from the URL
      let originalName = url.split('/').pop();

      // Handle URLs with query parameters or very long names
      if (originalName.includes('?')) {
        originalName = originalName.split('?')[0];
      }

      // If still too long or contains unusual characters, create a simpler name
      if (originalName.length > 50 || /[^a-zA-Z0-9.\-_]/.test(originalName)) {
        const ext = path.extname(originalName) || '.png'; // Default to .png if no extension
        originalName = `image-${Date.now().toString(36)}${ext}`;
      }

      const response = await axios.get(url, { responseType: 'arraybuffer' });
      const contentLength = parseInt(response.headers['content-length'] || '0', 10);

      const file = {
        originalname: originalName,
        mimetype: response.headers['content-type'] || '',
        buffer: Buffer.from(response.data),
        size: contentLength,
      };

      console.log('📥 File downloaded from URL:', file.originalname, file.mimetype);

      const attachment = await this.createAttachment(file, params);

      console.log('✅ Attachment from URL created successfully:', attachment);

      return attachment;
    } catch (error) {
      console.error('❌ [UploadService] createAttachmentFromUrl error:', error);
      throw error;
    }
  }
}

export default UploadService;
