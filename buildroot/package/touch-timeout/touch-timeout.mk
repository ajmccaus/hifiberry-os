################################################################################
#
# touch-timeout
#
################################################################################

TOUCH_TIMEOUT_VERSION = 2ad57698f9b219c3fb42e1085bf0e6080a5e9e10
TOUCH_TIMEOUT_SITE = $(call github,ajmccaus,touch-timeout,$(TOUCH_TIMEOUT_VERSION))
TOUCH_TIMEOUT_LICENSE = GPL-3.0
TOUCH_TIMEOUT_LICENSE_FILES = LICENSE

# Only override CC; the Makefile's own CFLAGS stay intact. SYSTEMD_PKG=no
# stops the Makefile's pkg-config probe from linking the build host's
# libsystemd into an aarch64 binary (sd_notify is unused: Type=simple).
define TOUCH_TIMEOUT_BUILD_CMDS
	$(TARGET_MAKE_ENV) $(MAKE) CC="$(TARGET_CC)" SYSTEMD_PKG=no -C $(@D) all
endef

define TOUCH_TIMEOUT_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(@D)/build/touch-timeout-*-native \
		$(TARGET_DIR)/usr/bin/touch-timeout
endef

define TOUCH_TIMEOUT_INSTALL_INIT_SYSTEMD
	$(INSTALL) -D -m 0644 $(@D)/systemd/touch-timeout.service \
		$(TARGET_DIR)/usr/lib/systemd/system/touch-timeout.service
	mkdir -p $(TARGET_DIR)/etc/systemd/system/multi-user.target.wants
	ln -sf ../../../../usr/lib/systemd/system/touch-timeout.service \
		$(TARGET_DIR)/etc/systemd/system/multi-user.target.wants/touch-timeout.service
endef

$(eval $(generic-package))
