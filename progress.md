Original prompt: Implement direct touch selection and plant placement: tap card then tap cell; drag card and plant on release.

Prior release: picture clarity confirmed on Samsung Tab S10+, synthetic mouse adapter still incorrect.
Current task: inspect real game UI/Mouse/Square/LnC interfaces, then implement and verify game-level touch adapter. Preserve game affordability, cooldown and placement checks.

Implemented direct-touch game bridge capturing UIInGame/Mouse/Square/LevelPlay exports from official main bundle. Select via tryChangingIndex; resolve current touch through Cocos view/Touch coordinate conversion; update lawn hover synchronously; call original PlaceUIPlant once on release. Existing mouse adapter retained for other controls. Added upstream API contract validation and true browser smoke test using official Docker game. Unit tests pass. First official browser run loaded game successfully but test used unresolved bare 'cc' namespace; fixed with System.resolve and rerunning. Device verification still outstanding.
