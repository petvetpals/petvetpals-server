import express from "express";
import { getUserDetails, googleAuth, updateUserDetails, updateUserTimezone, userLogin, userLogout, userRegister } from "../controllers/userController.js";
import userAuthenticated from "../middlewares/userAuthenticated.js"
const userRouter = express.Router();

userRouter.post("/register", userRegister);
userRouter.post("/login", userLogin);
userRouter.post("/google", googleAuth);
userRouter.post("/logout", userAuthenticated, userLogout);
userRouter.get("/user-details", userAuthenticated, getUserDetails);
userRouter.patch("/user-details", userAuthenticated, updateUserDetails)
userRouter.patch("/update-timezone", userAuthenticated, updateUserTimezone);

export default userRouter;