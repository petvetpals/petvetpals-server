import { NextFunction, Request, Response } from "express";
import { extractJSON } from "../../utils/extractJson.js";
import { AllergyItchReport } from "../../models/vet-gpt/AllergyItchModel.js";
import { AllergyReportDTO, SaveAllergyReportDTO } from "../../types/vet-gpt.types.js";
import { GenerateContentResult, GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

export const generateAllergyReport = async (req: Request<{}, {}, AllergyReportDTO>, res: Response, next: NextFunction) => {
    try {
        const {
            // Pet
            pet,
            // Current Episode
            startDate,
            affectedAreas,
            severity,
            visibleSigns,
            // Environment
            currentSeason,
            recentChanges,
            livingEnvironment,
            // Additional info
            currentMedications,
            knownAllergies,
            previousTreatments,
        } = req.body;
        console.log("pet:", pet)
        if (!startDate || !affectedAreas || !severity) {
            return res.status(400).json({ success: false, message: "Fields required - start date, affected areas and severity fields are required!" })
        }

        const prompt = `
        You are an expert AI Allergy & Itch Care Coach for pets, with extensive experience in veterinary dermatology and allergy management. 
        Create a structured, personalized, and actionable care plan based on the pet case below. Focus on safety, practicality, and prevention of complications. 
        Return a single valid JSON object that strictly matches the schema provided.

        ### Pet Allergy Case
        - Pet Species: ${pet.type}
        - Pet Name: ${pet.name}
        - Pet Breed: ${pet.breed}
        - Pet Gender: ${pet.gender}
        - Pet Age: ${pet.age}
        - Start Date: ${startDate}
        - Severity: ${severity}/10
        - Affected Areas: ${affectedAreas.join(", ")}
        - Visible Signs: ${visibleSigns.join(", ")}
        - Current Season: ${currentSeason || "unknown"}
        - Recent Changes: ${recentChanges.join(", ") || "none"}
        - Living Environment: ${livingEnvironment || "not specified"}
        - Current Medications: ${currentMedications.join(", ") || "none"}
        - Known Allergies: ${knownAllergies.join(", ") || "none"}
        - Previous Treatments: ${previousTreatments || "none"}

        ### Guidance for JSON Output
        - **urgencyLevel**: Consider severity, number of affected areas, visible signs, and risk of secondary infection. Use 'urgent', 'moderate', or 'routine'.
        - **vetConsultation**: True if professional assessment is needed, especially in severe cases or if infection is likely.
        - **immediateActions**: Provide safe, actionable steps that owners can take at home (e.g., gentle cool compress, bathing with medicated shampoo), **without recommending extra medications or unsafe doses**.
        - **homeCareTips**: Include daily routines, skin care, grooming, diet, and environmental management (e.g., wiping paws, using air filters, limiting allergen exposure). Each tip must be concise and practical.
        - **avoidanceList**: Based on known allergies and environmental triggers. Include actionable advice to reduce exposure.
        - **followUpSchedule**: Provide clear timeframe for monitoring and professional check-ups, prioritizing health and safety.
        - **rationale**: Include a short explanation (3–5 sentences) justifying the urgencyLevel and vetConsultation recommendations. Specifically mention:
            - Risk of infection due to scratching or redness
            - Known diet or environmental triggers
            - Reason why this case is urgent, moderate, or routine
        - **educationalInfo**: Provide concise, easy-to-understand explanations for the pet owner about:
            - Why these allergy and itch symptoms occur
            - Common misconceptions about pet allergies
            - Preventive measures to reduce future flare-ups

        ### JSON Schema
        {
        "urgencyLevel": "urgent | moderate | routine",
        "vetConsultation": true | false,
        "immediateActions": [ "..." ],
        "homeCareTips": [
            { "category": "string", "icon": "emoji", "tips": ["..."] }
        ],
        "avoidanceList": ["..."],
        "followUpSchedule": [
            { "timeframe": "string", "action": "string" }
        ],
        "rationale": "string",
        "educationalInfo": ["string"]
        }

        Now, from a pet allergy & itch coach perspective, generate the JSON output **for this case only**. 
        Do not repeat instructions, do not include explanations outside the JSON. Be professional, precise, and thorough, prioritizing ${pet.name}'s safety, comfort, and risk prevention.
        `;

        const model = genAI.getGenerativeModel({
            model: process.env.AI_MODEL as string,
            generationConfig: {
                temperature: 0.4,
                responseMimeType: "application/json"
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
                        `Gemini allergy attempt ${attempt + 1}/${retries} failed:`,
                        message
                    );

                    const lowerMessage = message.toLowerCase();

                    const isAIError =
                        message.includes("503") ||
                        message.includes("429") ||
                        message.includes("500") ||
                        lowerMessage.includes("high demand") ||
                        lowerMessage.includes("service unavailable") ||
                        lowerMessage.includes("too many requests") ||
                        lowerMessage.includes("quota");

                    // Don't retry errors that are not temporary
                    // Gemini/service errors.
                    if (!isAIError) {
                        throw error;
                    }

                    // All retries exhausted
                    if (attempt === retries - 1) {
                        throw new Error(
                            "Vet GPT is currently busy. Please try again later."
                        );
                    }

                    // Backoff:
                    // Attempt 1 → wait 1s
                    // Attempt 2 → wait 2s
                    await new Promise((resolve) =>
                        setTimeout(resolve, 1000 * (attempt + 1))
                    );
                }
            }

            throw new Error(
                "Failed to generate allergy report."
            );
        };

        try {
            const result = await generateWithRetry(prompt);

            const rawOutput = result.response.text();

            console.log(
                "ALLERGY RAW OUTPUT:",
                rawOutput
            );

            let coach_response;

            try {
                coach_response = JSON.parse(rawOutput);
            } catch (parseError) {

                console.error(
                    "Failed to parse Gemini allergy JSON:",
                    parseError
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Vet GPT returned an invalid allergy report. Please try again."
                });
            }

            console.log(
                "Coach Response:",
                coach_response
            );

            return res.status(200).json({
                success: true,
                coach_response
            });

        } catch (error: unknown) {

            console.error(
                "Gemini Allergy API Error:",
                error
            );

            const message =
                error instanceof Error
                    ? error.message
                    : "Something went wrong while generating the allergy report.";

            const lowerMessage = message.toLowerCase();

            const isBusyError =
                message.includes("503") ||
                message.includes("429") ||
                lowerMessage.includes("currently busy") ||
                lowerMessage.includes("quota") ||
                lowerMessage.includes("high demand") ||
                lowerMessage.includes("too many requests");

            return res.status(
                isBusyError ? 503 : 500
            ).json({
                success: false,
                message
            });
        }
    } catch (error: unknown) {
        next(error);
    }
}

export const saveAllergyReport = async (req: Request<{}, {}, SaveAllergyReportDTO>, res: Response, next: NextFunction) => {
    try {
        const { pet, episode } = req.body;
        if (!pet || !episode) {
            return res.status(400).json({ success: false, message: "Pet ID and episode fields are required!" });
        }
        const allergyItchReport = new AllergyItchReport({
            pet,
            episode
        });
        await allergyItchReport.save();
        return res.status(201).json({ success: true, message: "Allergy & Itch report saved successfully." });
    } catch (error: unknown) {
        next(error);
    }
}

export const getAllergyHistories = async (req: Request<{ petId: string }>, res: Response, next: NextFunction) => {
    try {
        const { petId } = req.params;
        if (!petId) {
            return res.status(400).json({ success: false, message: "Pet ID is required!" });
        }
        const reports = await AllergyItchReport.find({ pet: petId }).sort({ createdAt: -1 }).lean();
        return res.status(200).json({ success: true, reports });
    } catch (error: unknown) {
        next(error);
    }
}