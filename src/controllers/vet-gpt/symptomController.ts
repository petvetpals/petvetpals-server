import { NextFunction, Request, Response } from "express";
import { SymptomReport } from "../../models/vet-gpt/SymptomReport.js";
import { conditions, GenerateSymptomReportDTO, symptoms } from "../../types/vet-gpt.types.js";
import { GenerateContentResult, GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

export const generateSymptomReport = async (req: Request<{}, {}, GenerateSymptomReportDTO>, res: Response, next: NextFunction) => {
    try {
        const { pet, symptoms, conditions } = req.body;

        if (!pet || !symptoms || !conditions) {
            return res.status(400).json({ error: 'Missing required fields.' });
        }

        const prompt = `
            You are Vet GPT, a professional virtual veterinary assistant for PetVetPals. 
            Your role is to carefully analyze reported pet symptoms and suggest likely conditions, 
            recommend safe next steps, and provide owners with practical guidance. 
            Be thorough, accurate, and empathetic — but also clear that you are not a substitute for a licensed veterinarian.

            Pet Information:
            - Type: ${pet.type}
            - Name: ${pet.name}
            - Breed: ${pet.breed}
            - Age: ${pet.age}

            Reported Symptoms:
            ${symptoms.map(s => `- ${s.bodyPart}: ${s.symptoms.join(', ')}`).join('\n')}

            Possible Conditions (AI-matched):
            ${conditions.map(c => `- ${c.name} (${c.matchPercentage}%)`).join('\n')}

            Your task:
            1. Summarize the key symptoms in plain language so the owner understands what might be happening.
            2. Highlight the most relevant potential conditions (focus on those above 40–50% match).
            3. For each high-likelihood condition:
            - Provide a short explanation of the condition and why it might fit.
            - List possible severity (mild, moderate, urgent/emergency).
            - Suggest what the owner can do at home (if safe).
            - State clearly when the pet should be taken to the vet immediately.
            4. Suggest any additional signs or tests the owner should watch for before seeing a vet.
            5. Close with a warm, supportive summary encouraging responsible veterinary care.

            IMPORTANT:
            - Do not provide medication dosages or prescribe treatments.
            - Always emphasize consulting a licensed veterinarian for confirmation and treatment.
            - If symptoms suggest an emergency (e.g., difficulty breathing, seizures, sudden collapse), make that very clear.

            End your response with a line similar to this:
            "Thank you for using Vet GPT - Powered by PetVetPals."
            `.trim();

        const model = genAI.getGenerativeModel({
            model: process.env.AI_MODEL,
            generationConfig: {
                temperature: 0.4,
            }
        });

        const generateWithRetry = async (
            prompt: string,
            retries = 3
        ): Promise<GenerateContentResult> => {

            for (let attempt = 0; attempt < retries; attempt++) {
                try {
                    return await model.generateContent(prompt);

                } catch (error: unknown) {

                    const message =
                        error instanceof Error
                            ? error.message
                            : "Unknown error";

                    console.error(
                        `Gemini attempt ${attempt + 1}/${retries} failed:`,
                        message
                    );

                    const isAIError =
                        message.includes("503") ||
                        message.includes("429") ||
                        message.includes("500") ||
                        message.includes("high demand") ||
                        message.includes("Service Unavailable") ||
                        message.includes("Too Many Requests") ||
                        message.toLowerCase().includes("quota");

                    // Don't retry things like invalid API keys,
                    // malformed requests, etc.
                    if (!isAIError) {
                        throw error;
                    }

                    // Last attempt failed
                    if (attempt === retries - 1) {
                        throw new Error(
                            "VetGPT is currently busy. Please try again later."
                        );
                    }

                    // Exponential-ish backoff:
                    // 1s → 2s → 3s
                    await new Promise((resolve) =>
                        setTimeout(resolve, 1000 * (attempt + 1))
                    );
                }
            }

            throw new Error("Failed to generate symptom report.");
        };

        try {
            const result = await generateWithRetry(prompt);

            const content = result.response.text();

            console.log("SYMPTOM REPORT:", content);

            return res.status(200).json({
                success: true,
                recommendation: content
            });

        } catch (error: unknown) {

            console.error("Gemini API Error:", error);

            const message =
                error instanceof Error
                    ? error.message
                    : "Something went wrong while generating the report.";

            const isBusyError =
                message.includes("currently busy") ||
                message.includes("503") ||
                message.includes("429") ||
                message.toLowerCase().includes("quota");

            return res.status(isBusyError ? 503 : 500).json({
                success: false,
                message
            });
        }
    } catch (error: unknown) {
        next(error);
    }
}

export const saveSymptomReport = async (req: Request<{}, {}, { petId: string, symptoms: symptoms, conditions: conditions }>, res: Response, next: NextFunction) => {
    try {
        const { petId, symptoms, conditions } = req.body;
        // console.log("PET ID(Save):", petId)
        if (!petId || !symptoms || !conditions) {
            return res.status(400).json({ error: 'Missing required fields.' });
        }
        const report = new SymptomReport({ petId, symptoms, conditions });
        await report.save();
        return res.status(200).json({ message: 'Report saved successfully.' });
    } catch (error: unknown) {
        next(error);
    }
}

export const getSymptomHistory = async (req: Request<{ petId: string }, {}, {}>, res: Response, next: NextFunction) => {
    try {
        // console.log("PET ID(History):", req.params.petId)
        if (!req.params.petId) {
            return res.status(400).json({ success: false, message: "Pet ID isn't provided!" })
        }
        const reports = await SymptomReport.find({ petId: req.params.petId }).sort({ createdAt: -1 }).lean();
        return res.status(200).json(reports);
    } catch (error: unknown) {
        next(error);
    }
}