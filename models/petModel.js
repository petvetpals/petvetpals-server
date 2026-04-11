import mongoose from "mongoose";

const petSchema = mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    type: {
        type: String,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    image: {
        type: String,
        default: null,
        required: false
    },
    date_of_birth: {
        type: Date,
        required: true,
        default: null
    },
    breed: {
        type: String,
        default: "Unknown",
        required: false
    },
    gender: {
        type: String,
        enum: ["Male", "Female"],
        required: true
    },
    weight: [
        {
            value: { type: Number, required: true },
            date: { type: Date, default: Date.now }
        }
    ],
    activity_level: [
        {
            value: { type: Number, required: false, min: 0, max: 100 },
            date: { type: Date, default: Date.now }
        }
    ],
    energy_level: [
        {
            value: { type: Number, required: false, min: 0, max: 100 },
            date: { type: Date, default: Date.now }
        }
    ],
    overall_health: {
        type: Number,
        default: 70,
        min: 0,
        max: 100
    }
}, { timestamps: true })
export const Pet = mongoose.model("Pet", petSchema);