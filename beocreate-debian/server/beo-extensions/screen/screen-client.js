var screen_settings = (function() {

var screenBrightness = null;
var adjustingScreenBrightness = false;

$(document).on("general", function(event, data) {
	if (data.header == "connection") {
		if (data.content.status == "connected") {
			beo.send({target: "screen", header: "getBrightness"});
		}
	}

	if (data.header == "activatedExtension") {
		if (data.content.extension == "screen") {
			beo.send({target: "screen", header: "getBrightness"});
		}
	}
});

$(document).on("screen", function(event, data) {
	if (data.header == "brightness") {
		if (data.content.brightness != undefined) {
			screenBrightness = data.content.brightness;
			updateScreenBrightnessSlider();
		}
		if (data.content.available == false) {
			$("#screen .screen-no-backlight").removeClass("hidden");
			$("#screen-brightness-slider-wrap").addClass("disabled");
		} else {
			$("#screen .screen-no-backlight").addClass("hidden");
			$("#screen-brightness-slider-wrap").removeClass("disabled");
		}
	}
});

function updateScreenBrightnessSlider() {
	if (adjustingScreenBrightness == false) {
		$(".screen-brightness-slider").slider("value", screenBrightness);
	}
}

var adjustingReleaseTimeout;
$(".screen-brightness-slider").slider({
	range: "min",
	min: 0,
	max: 100,
	value: 0,
	slide: function( event, ui ) {
		beo.sendToProduct("screen", "setBrightness", ui.value);
	},
	start: function(event, ui) {
		adjustingScreenBrightness = true;
		clearTimeout(adjustingReleaseTimeout);
	},
	stop: function(event, ui) {
		beo.sendToProduct("screen", "setBrightness", ui.value);
		adjustingReleaseTimeout = setTimeout(function() {
			adjustingScreenBrightness = false;
			updateScreenBrightnessSlider();
		}, 300);
	}
});


return {
	updateScreenBrightnessSlider: updateScreenBrightnessSlider
};

})();
