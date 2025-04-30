import 'dotenv/config';
import AWS from 'aws-sdk';
import {v4 as uuidv4} from 'uuid';

// AWS SDK Configuration
const spacesEndpoint = new AWS.Endpoint(process.env.SPACES_ENDPOINT);
const s3 = new AWS.S3({
    endpoint: spacesEndpoint,
    accessKeyId: process.env.SPACES_KEY,
    secretAccessKey: process.env.SPACES_SECRET,
});

class UploadService {
    static async createAttachment(fileBuffer, params = {}) {
        try {
            // Asumiendo que fileBuffer es un Buffer y params contiene el mimeType y otros datos necesarios.
            const mimeType = params.mimeType || 'application/octet-stream'; // Tipo MIME por defecto
            const acl = params.acl || 'public-read';
            const extension = params.extension || 'mp3'; // Extensión por defecto
            const prefix = params.prefix || 'upload'; // Prefijo por defecto para la ubicación del archivo

            // Generación del nombre de archivo, ubicación, etc.
            const date = new Date();
            const year = date.getFullYear();
            let month = date.getMonth() + 1;
            month = month < 10 ? '0' + month : month;
            const filename = `${uuidv4()}.${extension}`; // Genera el nombre de archivo con la extensión correcta

            const s3Params = {
                Bucket: process.env.SPACES_BUCKET_NAME,
                Key: `${prefix}/${year}/${month}/${filename}`,
                Body: fileBuffer, // Asegúrate de que esto es un Buffer directamente.
                ACL: acl,
                ContentType: mimeType,
            };

            const data = await s3.upload(s3Params).promise();

            // Aquí el resto de tu lógica para manejar la respuesta de S3 y cualquier interacción con la base de datos.
            console.log("Upload successful:", data);

            return {
                attachment: {
                    attachment: `${prefix}/${year}/${month}/${filename}`,
                },
                data,
                url: data.Location,
            };
        } catch (error) {
            console.error("Error uploading file:", error);
            throw error;
        }
    }

    static async deleteAttachment(key) {
        try {
            const s3Params = {
                Bucket: process.env.SPACES_BUCKET_NAME,
                Key: key,
            };

            const data = await s3.deleteObject(s3Params).promise();
            console.log("Delete successful:", data);

            return data;
        } catch (error) {
            console.error("Error deleting file:", error);
            throw error;
        }
    }
}

export default UploadService;
