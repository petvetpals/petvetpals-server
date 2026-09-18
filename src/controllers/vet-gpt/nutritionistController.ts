import { NextFunction, Request, Response } from "express";
import { NutritionReportDTO } from "../../types/vet-gpt.types.js";
import { GenerateContentResult, GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

export const generateNutritionReport = async (req: Request<{}, {}, NutritionReportDTO>, res: Response, next: NextFunction) => {
    try {
        const { pet, activityLevel, medicalConditions, currentSymptoms, treatmentGoals, knownAllergies, currentDiet } = req.body;
        if (!pet || !activityLevel || !treatmentGoals) {
            return res.status(400).json({ success: false, message: "Pet, Activity Level, and Nutrition Goals are required!" });
        }

        const prompt = `
        You are a professional pet nutritionist specializing in dogs and cats. 
        Analyze the following pet details and provide a personalized nutrition plan. 
        **Output only valid JSON**, with no extra text, Markdown, or comments. 
        All values should be generated specifically for this pet based on its details.

        Pet Details:
        Species: ${pet.type}
        Pet Name: ${pet.name}
        Age: ${pet.age}
        Gender: ${pet.gender}
        Breed: ${pet.breed}
        Activity Level: ${activityLevel}
        Medical Conditions: ${medicalConditions?.length ? medicalConditions.join(", ") : "None"}
        Current Symptoms: ${currentSymptoms?.length ? currentSymptoms.join(", ") : "None"}
        Allergies: ${knownAllergies?.length ? knownAllergies.join(", ") : "None"}
        Current Diet: ${currentDiet?.length ? currentDiet.join(", ") : "None"}

        Required JSON format:
        {
        "dailyCalories": number,                // Total daily calories
        "proteinNeeds": "X-Y%",                 // Percentage of protein
        "fatNeeds": "X-Y%",                     // Percentage of fat
        "carbNeeds": "X-Y%",                    // Percentage of carbohydrates
        "feedingSchedule": [                     // List of meals
            { "meal": "Breakfast|Lunch|Dinner", "time": "HH:MM AM/PM", "portion": "amount" }
        ],
        "recommendedIngredients": [             // List of recommended ingredients
            { "name": "Ingredient name", "type": "Protein|Fat|Carbohydrate|Antioxidant", "benefit": "Reason for recommendation" }
        ],
        "avoidIngredients": [                   // Ingredients that are harmful for this pet
            "Ingredient1", "Ingredient2"
        ]
        }
        `
            ;

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
                        `Gemini nutrition attempt ${attempt + 1}/${retries} failed:`,
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

                    // Don't retry non-AI/service errors such as
                    // invalid API keys or malformed requests.
                    if (!isAIError) {
                        throw error;
                    }

                    // Last retry
                    if (attempt === retries - 1) {
                        throw new Error(
                            "Vet GPT is currently busy. Please try again later."
                        );
                    }

                    // Backoff: 1s → 2s → 3s
                    await new Promise((resolve) =>
                        setTimeout(resolve, 1000 * (attempt + 1))
                    );
                }
            }

            throw new Error(
                "Failed to generate nutrition plan."
            );
        };

        try {
            const result = await generateWithRetry(prompt);

            const rawOutput = result.response.text();

            console.log("NUTRITION RAW OUTPUT:", rawOutput);

            let plan;

            try {
                plan = JSON.parse(rawOutput);
            } catch (parseError) {
                console.error(
                    "Failed to parse Gemini nutrition JSON:",
                    parseError
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Vet GPT returned an invalid nutrition plan. Please try again."
                });
            }

            console.log("NUTRITION PLAN:", plan);

            return res.status(200).json({
                success: true,
                plan
            });

        } catch (error: unknown) {

            console.error(
                "Gemini Nutrition API Error:",
                error
            );

            const message =
                error instanceof Error
                    ? error.message
                    : "Something went wrong while generating the nutrition plan.";

            const lowerMessage = message.toLowerCase();

            const isBusyError =
                message.includes("503") ||
                message.includes("429") ||
                lowerMessage.includes("currently busy") ||
                lowerMessage.includes("quota") ||
                lowerMessage.includes("high demand");

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