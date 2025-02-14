from django.utils.deprecation import MiddlewareMixin

class LanguageCookieMiddleware(MiddlewareMixin):
    def process_response(self, request, response):
        if "openedx-language-preference" not in request.COOKIES:
            response.set_cookie(
                "openedx-language-preference",
                "en",
                max_age=31536000,
                path="/",
                samesite="Lax",
                domain=".pt.edtechlab.local",
            )
        return response
