/**
 * Header/footer chrome that mirrors spyconverter.com/index.html structure and links.
 */
export function LegacySiteHeader() {
  return (
    <div className="legacy-header-container">
      <nav className="legacy-nav">
        <a href="https://spyconverter.com/index.html" className="legacy-logo">
          <h4>spyconverter.com</h4>
        </a>
        <ul className="legacy-nav-links">
          <li>
            <a href="https://spyconverter.com/index.html">Home</a>
          </li>
          <li>
            <a href="https://news.spyconverter.com/news">News</a>
          </li>
          <li>
            <a href="https://spyconverter.com/relationship.html">Relationship</a>
          </li>
          <li>
            <a href="https://spyconverter.com/blog.html">Blog</a>
          </li>
          <li className="legacy-dropdown">
            <a href="https://spyconverter.com/aboutus.html">About Us</a>
            <div className="legacy-dropdown-content">
              <a href="https://spyconverter.com/aboutus.html#about-us">About Us</a>
              <a href="https://spyconverter.com/aboutus.html#privacy-policy">Privacy Policy</a>
              <a href="https://spyconverter.com/aboutus.html#contact-us">Contact Us</a>
              <a href="https://spyconverter.com/aboutus.html#disclaimer">Disclaimer</a>
              <a href="https://spyconverter.com/aboutus.html#terms-and-conditions">
                Terms and Conditions
              </a>
            </div>
          </li>
          <li>
            <a href="https://spyconverter.com/docs/login.html">Login</a>
          </li>
        </ul>
      </nav>
    </div>
  );
}

export function LegacySiteFooter() {
  return (
    <footer className="legacy-footer">
      <p>© 2026 spyconverter.com. All rights reserved.</p>
    </footer>
  );
}
